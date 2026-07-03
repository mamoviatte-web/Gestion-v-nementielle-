-- ═══════════════════════════════════════════════════════════════════
-- Réorganisation des dépôts + gestion des fûts (appliqué via MCP le 2026-07-03).
--
-- 3 dépôts reserve_centrale :
--   • AUC — Réserve générale : matériel, softs, sirops, bières bouteilles.
--   • Stock EST — Cave vins & spiritueux : vins, champagnes, spiritueux.
--   • Stockage Fûts : tous les fûts + CO2 (réception, pleins/vides, retours).
--
-- NB schéma réel (≠ SQL du prompt) :
--   - stock_balances.current_quantity (pas current_qty).
--   - stock_locations n'a pas de contrainte UNIQUE(name) → NOT EXISTS au lieu
--     de ON CONFLICT (name).
--   - RLS via helper is_stade() (le rôle applicatif est dans user_metadata).
-- ═══════════════════════════════════════════════════════════════════

-- ── ÉTAPE 1 : dépôt Stockage Fûts ──────────────────────────────────
INSERT INTO stock_locations (name, location_type, description, is_active)
SELECT 'Stockage Fûts','reserve_centrale',
  'Dépôt central des fûts. Réception livraisons fournisseurs. Suivi fûts pleins et vides retournés. Départ vers les espaces événements.',
  true
WHERE NOT EXISTS (SELECT 1 FROM stock_locations WHERE name='Stockage Fûts');

-- ── ÉTAPE 2 : répartition des balances ─────────────────────────────
-- Stockage Fûts ← fûts + CO2 ; Stock EST ← vins+spiritueux ; AUC ← retrait
-- des fûts, vins, spiritueux et CO2. (stock_balances, current_quantity 0.)

-- ── ÉTAPE 3 : keg_inventory + volumes standards + vue keg_summary ───
CREATE TABLE IF NOT EXISTS keg_inventory (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products(product_id),
  status                  TEXT NOT NULL CHECK (status IN ('plein','en_espace','vide','retourné')),
  qty                     INT NOT NULL DEFAULT 1,
  volume_liters           DECIMAL(6,2),
  event_id                UUID REFERENCES events(event_id),
  space_id                UUID REFERENCES spaces(space_id),
  delivery_id             UUID REFERENCES supplier_deliveries(id),
  received_at             TIMESTAMPTZ,
  dispatched_at           TIMESTAMPTZ,
  returned_empty_at       TIMESTAMPTZ,
  returned_to_supplier_at TIMESTAMPTZ,
  lot_reference           TEXT,
  notes                   TEXT,
  responsable_nom         TEXT,
  created_at              TIMESTAMPTZ DEFAULT now()
);
-- + index (product/status/event), RLS is_stade().

CREATE TABLE IF NOT EXISTS keg_volume_standards (
  product_id    UUID PRIMARY KEY REFERENCES products(product_id),
  volume_liters DECIMAL(6,2) NOT NULL,
  keg_type      TEXT
);
-- Seed : 30L (BUD, LEFFE, FADA Blonde) / 20L (Hoegaarden, Goose, FADA Blanche/IPA/Abricot).

-- keg_summary : pleins / en_espace / vides / retournes + litres = Σ(qty × volume).
--   (correctif : le volume stocké est unitaire, le total pondère par qty.)

-- ── ÉTAPE 4 : trigger fût vide automatique ─────────────────────────
-- auto_register_empty_keg : à la clôture d'une ligne product_state ∈
-- ('fût_vide','fût_percuté'), crée une entrée keg_inventory 'vide' (qty consommée).

-- Nouveau movement_type 'retour_fournisseur' (retours fûts vides au fournisseur).

-- ── ÉTAPE 7 : démo ─────────────────────────────────────────────────
-- Pleins : BUD 8, LEFFE 4, FADA Blonde 4, FADA Blanche/IPA/Abricot 2,
--          Hoegaarden 2, Goose Island 2. Vides : 3 × Fût BUD.
-- stock_balances du dépôt Fûts alignés sur les fûts pleins.
