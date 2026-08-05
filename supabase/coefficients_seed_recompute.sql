-- ═══════════════════════════════════════════════════════════════════════════
-- coefficients_seed_recompute.sql — recalcule la colonne `coefficient` des
-- lignes seed (base « 5 matchs », migration 038).
--
-- Problème corrigé : inject_5match_coefficients() (038) ne remplissait PAS la
-- colonne `coefficient` → elle valait 1.00 par défaut pour les 179 lignes, et
-- la page Coefficients (vue v_space_dotation_recommendations → coeff_espace)
-- affichait « ×1.00 » partout (dont Bistrot/Bodega).
--
-- Correctif : coefficient = conso moyenne de l'espace / moyenne du PROFIL
-- d'espace (space_profile) pour ce produit — cohérent avec
-- compute_space_coefficients (040). NON destructif : aucune ligne supprimée,
-- la base de référence est conservée. Idempotent / re-jouable.
--
-- ⚠ Déjà appliqué en production le 2026-08-05 via l'API REST (DML autorisée
--   par la clé service_role). Ce fichier assure la reproductibilité d'un
--   rebuild complet depuis les migrations.
-- ═══════════════════════════════════════════════════════════════════════════

WITH profile_avg AS (
  SELECT space_profile(s.space_name) AS profile,
         spc.product_id,
         AVG(spc.avg_consumption) AS type_avg
  FROM space_product_coefficients spc
  JOIN spaces s ON s.space_id = spc.space_id
  WHERE COALESCE(spc.source, 'computed') = 'seed'
    AND spc.avg_consumption > 0
  GROUP BY space_profile(s.space_name), spc.product_id
)
UPDATE space_product_coefficients spc
SET coefficient = CASE
      WHEN COALESCE(pa.type_avg, 0) > 0
        THEN ROUND((spc.avg_consumption / pa.type_avg)::numeric, 2)
      ELSE 1.00 END,
    last_computed_at = now()
FROM spaces s
JOIN profile_avg pa ON pa.profile = space_profile(s.space_name)
WHERE s.space_id = spc.space_id
  AND pa.product_id = spc.product_id
  AND COALESCE(spc.source, 'computed') = 'seed';
