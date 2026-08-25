-- Base stock — fûts retirés de stock_balances (keg = source unique)
-- ============================================================================
-- Décision : le stock des fûts (+ CO2) est piloté exclusivement par le
-- sous-système keg (keg_inventory → keg_true_balance), affiché sur le tableau
-- « Fûts ». La copie que stock_balances gardait des fûts avait dérivé et
-- doublonnait le suivi : elle valorisait les fûts à 40 327 € alors que le stock
-- physique keg vaut ~25 k€. Cette copie faussait le Tableau de bord Stock et le
-- Rapport général (qui lisent stock_balances).
--
-- On supprime donc TOUTES les lignes fûts/CO2 de stock_balances (réserve + espace).
-- Aucune perte de stock réel : le stock fût authentique reste intégralement dans
-- le sous-système keg (inchangé). Le board runner lit déjà keg_true_balance pour
-- les fûts (migration précédente). Un garde-fou front empêche leur réapparition
-- dans les vues stock générales.
--
-- (15 lignes, 384 unités « fantômes » supprimées.)

delete from stock_balances b
 using products p
 where b.product_id = p.product_id
   and (p.unit = 'fût' or p.product_name = 'CO2');
