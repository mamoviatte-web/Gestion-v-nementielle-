-- ═══════════════════════════════════════════════════════════════════════════
-- set_missing_prices.sql — audit + renseignement des prix HT manquants
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Audit : produits actifs sans prix HT
SELECT product_name, category, unit
  FROM products
 WHERE unit_price_ht IS NULL AND active = true
 ORDER BY category, product_name;

-- 2) Blanc Montaurone — prix ESTIMÉ à confirmer (autres blancs : 3,64–6,50 €).
--    ⚠ Remplace 5.20 par le tarif réel dès que tu l'as.
UPDATE products
   SET unit_price_ht = 5.20
 WHERE product_name ILIKE '%Montaur%' AND active = true AND unit_price_ht IS NULL;

-- 3) Vérification
SELECT product_name, unit_price_ht
  FROM products WHERE product_name ILIKE '%Montaur%';
