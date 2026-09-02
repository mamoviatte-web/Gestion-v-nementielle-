-- Grand livre de transmission du stockage espace (matchs ↔ séminaires)
-- ============================================================================
-- Base d'observation pour maintenir un stock PRÉCIS dans les espaces à stock
-- conservé (Salons/Loges partagés entre matchs et séminaires). Montre, par
-- espace et par produit, la chronologie des événements et l'effet de chacun
-- sur le stockage :
--   • séminaire → décrément (espace −= consommation) : maintient le solde courant
--   • match (retains) → recompte physique (espace = restant) : ré-ancre le solde
-- Un match dont le restant est compté « stock total physique » ré-ancre le solde
-- proprement ; entre deux matchs, les séminaires tiennent le solde à jour.

CREATE OR REPLACE VIEW public.espace_stock_ledger AS
SELECT
  sp.space_id, sp.space_name, sp.space_type,
  p.product_id, p.product_name, p.category,
  e.event_id, e.event_date, e.event_name, e.event_type, e.status,
  COALESCE(l.initial_qty,0)  AS initial,
  COALESCE(l.reassort_qty,0) AS reassort,
  l.final_qty                AS restant,
  l.consumed_qty             AS consomme,
  CASE
    WHEN e.event_type = 'séminaire'
      THEN 'décrément −' || COALESCE(l.consumed_qty,0)::text
    WHEN COALESCE(sp.retains_stock,false)
      THEN 'recompte = ' || COALESCE(l.final_qty,0)::text
    ELSE 'retour réserve'
  END AS effet_stockage
FROM event_stock_lines l
JOIN events   e  ON e.event_id  = l.event_id
JOIN spaces   sp ON sp.space_id = l.space_id
JOIN products p  ON p.product_id = l.product_id
WHERE COALESCE(sp.retains_stock,false)          -- espaces à stock conservé
  AND (COALESCE(l.initial_qty,0) <> 0 OR COALESCE(l.reassort_qty,0) <> 0 OR l.final_qty IS NOT NULL);
