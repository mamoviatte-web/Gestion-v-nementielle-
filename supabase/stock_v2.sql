-- ═══════════════════════════════════════════════════════════════════
-- CDC V2 — « Charte de maîtrise des stocks et liaison événements »
-- Stock localisé : emplacements hiérarchiques, soldes courants, inventaires.
-- Enrichit (ne remplace pas) products / stock_movements.
-- Idempotent. Appliqué via Supabase MCP le 2026-07-01.
-- RLS alignée sur les helpers existants is_stade() / app_role() / app_space_id().
-- ═══════════════════════════════════════════════════════════════════

-- ─── Emplacements hiérarchiques ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_locations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  location_type      TEXT NOT NULL CHECK (location_type IN (
                       'reserve_centrale','espace','frigo','bac','palette','zone_temporaire_evenement')),
  parent_location_id UUID REFERENCES stock_locations(id),
  area_id            UUID REFERENCES spaces(space_id),
  is_active          BOOLEAN DEFAULT true,
  description        TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- ─── Solde courant par produit × emplacement (source de vérité) ─────
CREATE TABLE IF NOT EXISTS stock_balances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(product_id),
  location_id       UUID NOT NULL REFERENCES stock_locations(id),
  current_quantity  DECIMAL(10,2) NOT NULL DEFAULT 0,
  reusable_quantity DECIMAL(10,2) DEFAULT 0,
  opened_quantity   DECIMAL(10,2) DEFAULT 0,
  unit_value_ht     DECIMAL(10,2),
  last_movement_at  TIMESTAMPTZ DEFAULT now(),
  updated_by        TEXT,
  UNIQUE(product_id, location_id)
);

-- ─── Inventaires physiques périodiques ──────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_counts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id          UUID NOT NULL REFERENCES stock_locations(id),
  product_id           UUID NOT NULL REFERENCES products(product_id),
  theoretical_qty      DECIMAL(10,2),
  real_qty             DECIMAL(10,2),
  variance             DECIMAL(10,2) GENERATED ALWAYS AS (real_qty - theoretical_qty) STORED,
  responsible_name     TEXT NOT NULL,
  comment              TEXT,
  counted_at           TIMESTAMPTZ DEFAULT now(),
  validated_by         TEXT,
  validated_at         TIMESTAMPTZ,
  inventory_session_id UUID
);

-- ─── Enrichissement products ────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock INT DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_stock INT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS qr_code TEXT UNIQUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fournisseur TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_qty INT DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_unit TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ─── Enrichissement stock_movements (mouvements localisés) ──────────
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS from_location_id UUID REFERENCES stock_locations(id);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS to_location_id UUID REFERENCES stock_locations(id);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_price_ht DECIMAL(10,2);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS is_anomaly BOOLEAN DEFAULT false;

-- Mouvements généraux (entrée fournisseur en réserve) : event/space facultatifs.
ALTER TABLE stock_movements ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN space_id DROP NOT NULL;
-- Étendre le CHECK movement_type aux 7 types localisés CDC V2 (union avec RG-002).
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'entrée','sortie','réassort','retour','casse','perte','correction','inventaire',
    'entrée_fournisseur','transfert_espace','réassort_événement','retour_réutilisable','consommation','perte_casse'));

-- ─── Index ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_balances_product ON stock_balances(product_id);
CREATE INDEX IF NOT EXISTS idx_balances_location ON stock_balances(location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_session ON inventory_counts(inventory_session_id);
CREATE INDEX IF NOT EXISTS idx_movements_from ON stock_movements(from_location_id);
CREATE INDEX IF NOT EXISTS idx_movements_to ON stock_movements(to_location_id);

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE stock_locations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stade_full_locations ON stock_locations;
CREATE POLICY stade_full_locations ON stock_locations FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

DROP POLICY IF EXISTS stade_full_balances ON stock_balances;
CREATE POLICY stade_full_balances ON stock_balances FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

DROP POLICY IF EXISTS stade_full_inventory ON inventory_counts;
CREATE POLICY stade_full_inventory ON inventory_counts FOR ALL TO authenticated
  USING (is_stade()) WITH CHECK (is_stade());

-- ROLE_RESPONSABLE : lecture seule des balances/emplacements de son espace (RG-003 : jamais les coûts côté front)
DROP POLICY IF EXISTS responsable_read_balances ON stock_balances;
CREATE POLICY responsable_read_balances ON stock_balances FOR SELECT TO authenticated
  USING (
    app_role() = 'ROLE_RESPONSABLE'
    AND location_id IN (SELECT id FROM stock_locations WHERE area_id = app_space_id())
  );

DROP POLICY IF EXISTS responsable_read_locations ON stock_locations;
CREATE POLICY responsable_read_locations ON stock_locations FOR SELECT TO authenticated
  USING (app_role() = 'ROLE_RESPONSABLE' AND area_id = app_space_id());

-- ═══════════════════════════════════════════════════════════════════
-- DONNÉES DE RÉFÉRENCE (idempotentes)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO stock_locations (name, location_type)
SELECT 'Réserve centrale', 'reserve_centrale'
WHERE NOT EXISTS (SELECT 1 FROM stock_locations WHERE location_type = 'reserve_centrale');

INSERT INTO stock_locations (name, location_type, area_id)
SELECT s.space_name || ' — Espace', 'espace', s.space_id
FROM spaces s
WHERE s.active = true
  AND NOT EXISTS (SELECT 1 FROM stock_locations l WHERE l.area_id = s.space_id AND l.location_type = 'espace');

UPDATE products SET
  min_stock = CASE category
    WHEN 'Bières' THEN 2 WHEN 'Vins' THEN 5 WHEN 'Soft' THEN 24 WHEN 'Spiritueux' THEN 1 ELSE 0 END,
  max_stock = CASE category
    WHEN 'Bières' THEN 20 WHEN 'Vins' THEN 60 WHEN 'Soft' THEN 200 WHEN 'Spiritueux' THEN 12 ELSE NULL END
WHERE min_stock = 0 OR min_stock IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- DONNÉES DE DÉMONSTRATION — soldes réserve centrale (ÉTAPE 9)
-- ═══════════════════════════════════════════════════════════════════
WITH reserve AS (SELECT id FROM stock_locations WHERE location_type = 'reserve_centrale' LIMIT 1)
INSERT INTO stock_balances (product_id, location_id, current_quantity, unit_value_ht)
SELECT p.product_id, reserve.id,
  CASE p.category
    WHEN 'Vins' THEN floor(random() * 40 + 10)
    WHEN 'Bières' THEN floor(random() * 8 + 2)
    WHEN 'Soft' THEN floor(random() * 200 + 50)
    WHEN 'Spiritueux' THEN floor(random() * 15 + 3)
    ELSE floor(random() * 20 + 5)
  END,
  p.unit_price_ht
FROM products p, reserve
WHERE p.active = true
ON CONFLICT (product_id, location_id) DO NOTHING;
