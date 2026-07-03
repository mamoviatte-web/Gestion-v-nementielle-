-- ═══════════════════════════════════════════════════════════════════
-- Dépôts centraux + livraisons fournisseurs (appliqué via MCP le 2026-07-03).
--
-- Deux dépôts `reserve_centrale` :
--   • AUC — Réserve générale : point d'entrée de toutes les livraisons
--     fournisseurs, source du dispatch vers les 16 espaces (renommage de
--     l'ancienne « Réserve centrale » — conserve son id et ses soldes).
--   • Stock EST — Cave vins & spiritueux : conservation des vins, champagnes
--     et spiritueux (reliquats réutilisables).
--
-- Une livraison alimente un dépôt : l'INSERT d'une ligne déclenche le trigger
-- `trg_delivery_update_balance` → +stock_balances + mouvement `entrée_fournisseur`
-- (RG-002). Ce fichier documente la couche DB attendue par le front ; il est
-- idempotent si ré-exécuté.
-- ═══════════════════════════════════════════════════════════════════

-- ── ÉTAPE 1 : les 2 dépôts ─────────────────────────────────────────
UPDATE stock_locations
   SET name = 'AUC — Réserve générale',
       description = 'Réserve générale — point d''entrée de toutes les livraisons fournisseurs, dispatch vers les 16 espaces.'
 WHERE name = 'Réserve centrale' AND location_type = 'reserve_centrale';

INSERT INTO stock_locations (name, location_type, is_active, description)
SELECT 'Stock EST — Cave vins & spiritueux', 'reserve_centrale', true,
       'Cave de conservation des vins, champagnes et spiritueux — reliquats réutilisables.'
WHERE NOT EXISTS (SELECT 1 FROM stock_locations WHERE name = 'Stock EST — Cave vins & spiritueux');

-- ── ÉTAPE 2 : soldes initialisés à 0 ───────────────────────────────
-- AUC : tous les produits actifs. EST : vins + spiritueux uniquement.
-- (INSERT … ON CONFLICT (product_id, location_id) DO NOTHING.)

-- ── ÉTAPE 3/4/5 : livraisons + trigger + vue dispatch ──────────────

CREATE TABLE IF NOT EXISTS supplier_deliveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_name TEXT NOT NULL,
  location_id   UUID NOT NULL REFERENCES stock_locations(id),
  invoice_ref   TEXT,
  received_by   TEXT,
  status        TEXT DEFAULT 'reçu',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_delivery_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id   UUID NOT NULL REFERENCES supplier_deliveries(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(product_id),
  qty_ordered   INT,
  qty_received  INT NOT NULL DEFAULT 0,
  qty_refused   INT DEFAULT 0,
  unit_price_ht NUMERIC(10,2),
  lot_number    TEXT,
  expiry_date   DATE,
  notes         TEXT
);

-- RLS : ROLE_STADE uniquement (is_stade()).
ALTER TABLE supplier_deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_delivery_lines  ENABLE ROW LEVEL SECURITY;

-- Trigger : chaque ligne créditée sur le dépôt + mouvement `entrée_fournisseur`.
CREATE OR REPLACE FUNCTION update_balance_on_delivery()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_location UUID; v_received_by TEXT;
BEGIN
  SELECT location_id, received_by INTO v_location, v_received_by
    FROM supplier_deliveries WHERE id = NEW.delivery_id;

  INSERT INTO stock_movements (product_id, to_location_id, movement_type, qty, unit_price_ht, responsable_nom, is_anomaly)
  VALUES (NEW.product_id, v_location, 'entrée_fournisseur', NEW.qty_received, NEW.unit_price_ht, COALESCE(v_received_by, 'Livraison'), false);

  INSERT INTO stock_balances (product_id, location_id, current_quantity, unit_value_ht, last_movement_at)
  VALUES (NEW.product_id, v_location, NEW.qty_received, NEW.unit_price_ht, now())
  ON CONFLICT (product_id, location_id) DO UPDATE
    SET current_quantity = stock_balances.current_quantity + NEW.qty_received,
        unit_value_ht    = COALESCE(EXCLUDED.unit_value_ht, stock_balances.unit_value_ht),
        last_movement_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_delivery_update_balance ON supplier_delivery_lines;
CREATE TRIGGER trg_delivery_update_balance
  AFTER INSERT ON supplier_delivery_lines
  FOR EACH ROW EXECUTE FUNCTION update_balance_on_delivery();

-- Vue dispatch : stock en dépôt + quantités dispatchées vers les espaces.
CREATE OR REPLACE VIEW depot_dispatch_view WITH (security_invoker = true) AS
SELECT sl_from.id AS depot_id, sl_from.name AS depot_name,
       p.product_id, p.product_name, p.category, p.unit,
       sb.current_quantity AS qty_in_depot,
       COALESCE(dispatched.total_dispatched, 0) AS total_dispatched,
       dispatched.spaces_detail
  FROM stock_balances sb
  JOIN stock_locations sl_from ON sl_from.id = sb.location_id
  JOIN products p ON p.product_id = sb.product_id
  LEFT JOIN (
    SELECT sm.product_id, sm.from_location_id,
           sum(sm.qty) AS total_dispatched,
           json_agg(json_build_object('space_name', sl_to.name, 'qty', sm.qty, 'date', sm.created_at::date)
                    ORDER BY sm.created_at DESC) AS spaces_detail
      FROM stock_movements sm
      JOIN stock_locations sl_to ON sl_to.id = sm.to_location_id
     WHERE sm.movement_type = ANY (ARRAY['transfert_espace', 'réassort_événement'])
     GROUP BY sm.product_id, sm.from_location_id
  ) dispatched ON dispatched.product_id = sb.product_id
              AND dispatched.from_location_id = sb.location_id
 WHERE sl_from.location_type = 'reserve_centrale' AND p.active = true
 ORDER BY sl_from.name, p.category, p.product_name;

-- ── ÉTAPE 9 : livraisons de démonstration ──────────────────────────
-- AUC ← « Maison Castel » (2026-07-01) : rosés, softs, fût BUD.
-- EST ← « Cave Provençale » (2026-07-02) : Mumm, Rosé Miraval, spiritueux.

-- ── ÉTAPE 8 (front) : les alertes rupture n'utilisent que les soldes des
-- emplacements opérationnels (espaces) ; les dépôts `reserve_centrale` sont
-- exclus. Voir useStockAlerts / useDashboardLive / useCriticalStatus.
