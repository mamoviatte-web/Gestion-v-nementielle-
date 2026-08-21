-- ═══════════════════════════════════════════════════════════════════════════
-- Rattachement de chaque produit à son dépôt de stockage (product_depot_routing).
--
-- Intègre notamment « Rouge Paradis » (Château Paradis) au dépôt Stock EST — Cave
-- vins & spiritueux, comme tous les autres vins. Complète tous les produits actifs
-- non encore rattachés, selon le dépôt de leur catégorie :
--   • Vins / Spiritueux                 → Stock EST — Cave vins & spiritueux
--   • Fûts / CO2 (Bières pression)       → Stockage Fûts
--   • Softs / Sirops / bières bouteille  → AUC — Réserve générale
-- Les produits mal catégorisés « Soft » mais réellement vins/anis (Pastis, Vin …)
-- sont rattachés à Stock EST par leur libellé. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.product_depot_routing (product_id, depot_id, depot_name, priority)
SELECT p.product_id, d.id, d.name, 1
FROM public.products p
JOIN public.stock_locations d ON d.id = (
  CASE
    WHEN p.category IN ('Vins', 'Spiritueux')
      THEN '2123f4de-e760-415b-9f9d-520a0053c3c8'::uuid
    WHEN p.product_name ~* '(^|\s)vin(\s|$)'
      OR p.product_name ~* 'pastis|ricard|lillet|whisky|get 27|rhum|vodka|gin'
      THEN '2123f4de-e760-415b-9f9d-520a0053c3c8'::uuid
    WHEN p.category = 'Bières' AND p.product_name ~* 'f[uû]t|co2'
      THEN '936472cf-25c7-43d3-bbd4-23a809906d82'::uuid
    ELSE 'a291e38e-4d5d-42de-9277-fa6eec4d2592'::uuid   -- défaut : AUC
  END
)
WHERE p.active = true
  AND NOT EXISTS (SELECT 1 FROM public.product_depot_routing r WHERE r.product_id = p.product_id);
