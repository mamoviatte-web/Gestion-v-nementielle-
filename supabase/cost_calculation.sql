-- ═══════════════════════════════════════════════════════════════════
-- Calcul des coûts F&B (appliqué via MCP le 2026-07-03).
-- PRINCIPE : coût = products.unit_price_ht × quantité_consommée,
--            quantité_consommée = initial + réassort − final.
-- Le coût n'est jamais saisi ; il est calculé/stocké automatiquement.
--
-- NB : la table réelle event_stock_lines (PK line_id) n'avait ni
-- consumed_qty ni consumption_cost_ht — ces colonnes sont ajoutées ici.
-- event_consumptions.total_cost_ht est une colonne GÉNÉRÉE (jamais UPDATE
-- directement) : on rafraîchit unit_price_ht et le total suit.
-- ═══════════════════════════════════════════════════════════════════

-- ── ÉTAPE 1/2 : colonnes coût + trigger de recalcul temps réel ─────
ALTER TABLE event_stock_lines
  ADD COLUMN IF NOT EXISTS consumed_qty         integer,
  ADD COLUMN IF NOT EXISTS consumption_cost_ht  numeric(10,2);

CREATE OR REPLACE FUNCTION auto_compute_line_cost()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_price numeric(10,2);
BEGIN
  SELECT unit_price_ht INTO v_price FROM products WHERE product_id = NEW.product_id;
  IF NEW.final_qty IS NULL THEN
    NEW.consumed_qty := NULL;
    NEW.consumption_cost_ht := NULL;               -- clôture non faite
  ELSE
    NEW.consumed_qty := NEW.initial_qty + COALESCE(NEW.reassort_qty, 0) - NEW.final_qty;
    NEW.consumption_cost_ht := CASE WHEN v_price IS NULL THEN NULL   -- RG-005
                                    ELSE v_price * NEW.consumed_qty END;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_auto_compute_line_cost ON event_stock_lines;
CREATE TRIGGER trg_auto_compute_line_cost
  BEFORE INSERT OR UPDATE ON event_stock_lines
  FOR EACH ROW EXECUTE FUNCTION auto_compute_line_cost();

-- Backfill de l'existant + refresh event_consumptions.unit_price_ht.
UPDATE event_stock_lines esl
   SET consumed_qty = esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty,
       consumption_cost_ht = CASE WHEN p.unit_price_ht IS NULL THEN NULL
         ELSE p.unit_price_ht * (esl.initial_qty + COALESCE(esl.reassort_qty,0) - esl.final_qty) END
  FROM products p
 WHERE p.product_id = esl.product_id AND esl.final_qty IS NOT NULL;

UPDATE event_consumptions ec
   SET unit_price_ht = p.unit_price_ht
  FROM products p
 WHERE p.product_id = ec.product_id AND p.unit_price_ht IS NOT NULL AND ec.consumed_qty > 0;

-- ── ÉTAPE 3 : vues coûts (security_invoker) ────────────────────────
-- event_cost_details  : une ligne par event × space × produit finalisé
--   (unit_price_ht, initial/reassort/final, consumed_qty, line_cost_ht, cost_per_pax)
-- event_cost_by_category : agrégat par famille
-- event_cost_summary  : total_fb_cost_ht / _ttc (×1.20) / fb_cost_per_pax
--   + nb_products_no_price / nb_negative_conso / nb_priced_lines
-- Voir migration cost_views_and_overdotations pour le DDL complet.

-- ── ÉTAPE 5.3 : costly_overdotations ───────────────────────────────
-- Retours immobilisant > 50 € HT (final_qty × unit_price_ht), taux de retour.

-- ── Convenience : compute_event_full_cost(uuid) ────────────────────
-- Force le recalcul des lignes puis renvoie event_cost_summary en jsonb.

-- ── ÉTAPE 7 : vérification AIRBUS ──────────────────────────────────
-- Bière en verre 1.34×8=10.72 · Pepsi 1.80×6=10.80 · Rosé Miraval 8.50×2=17.00
-- · Fût LEFFE 129.75×0=0.00  ⇒  Total 38.52 € HT / 46.22 € TTC / 0.296 €/pax.
-- Surdotations : Fût LEFFE 259.50 € immobilisés (retour 100 %), Rosé Miraval 85.00 €.
