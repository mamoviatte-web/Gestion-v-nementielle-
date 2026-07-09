-- ═══════════════════════════════════════════════════════════════════════════
-- terrasse_pmr_bottles.sql — Terrasses & PMR : bouteilles uniquement.
--
-- Terrain (Excel PMR Terrasses) : PAS de pression → aucun fût, aucun CO2.
-- Bières = bouteilles individuelles (Bière en verre BUD + FADA en BOUTEILLE).
--
-- ⚠ Adaptations au schéma réel :
--   • Les FADA en bouteille existent déjà (« FADA X Bouteille », prix renseignés)
--     → on NE crée PAS de doublons « FADA X BTL ». On leur ajoute le profil.
--   • Softs 50cl aromatisés (Pepsi/Orangina/Ice Tea 50cl) retirés de terrasse
--     (le terrain ne liste que bouteilles + Cristaline 50cl eau).
--   • Aucune dotation/saisie n'existe pour Terrasses/Garden Party → rien à
--     nettoyer ; le filtre de profil suffit à masquer les fûts.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Retirer les fûts pression + CO2 de terrasse ─────────────────────────────
UPDATE products SET space_types = array_remove(space_types, 'terrasse')
WHERE 'terrasse' = ANY(space_types)
  AND (unit = 'fût' OR product_name IN ('CO2', 'C02'));

-- Retirer les softs 50cl aromatisés de terrasse (terrain = bouteilles only).
UPDATE products SET space_types = array_remove(space_types, 'terrasse')
WHERE 'terrasse' = ANY(space_types)
  AND (product_name ILIKE '%Pepsi 50%' OR product_name ILIKE '%Orangina 50%'
       OR product_name ILIKE '%Ice Tea 50%' OR product_name ILIKE '%San Pellegrino 50%');

-- Défensif : retirer fûts + CO2 de pmr (aucun attendu).
UPDATE products SET space_types = array_remove(space_types, 'pmr')
WHERE 'pmr' = ANY(space_types)
  AND (unit = 'fût' OR product_name IN ('CO2', 'C02'));

-- ── FADA en BOUTEILLE : exclusives terrasse + pmr ───────────────────────────
UPDATE products SET space_types = ARRAY['terrasse','pmr']
WHERE active AND product_name ILIKE '%FADA%Bouteille%';

-- ── Gamme réelle terrasse = pmr (bouteilles) ────────────────────────────────
-- Vins bouteille + Bière en verre + softs bouteille/eau + sirops.
DO $$
DECLARE v_prof TEXT;
BEGIN
  FOREACH v_prof IN ARRAY ARRAY['terrasse','pmr'] LOOP
    UPDATE products SET space_types = array_append(COALESCE(space_types, '{}'), v_prof)
    WHERE active
      AND NOT (v_prof = ANY(COALESCE(space_types, '{}')))
      AND product_name ILIKE ANY (ARRAY[
        -- Vins bouteille
        '%Rosé NAIS%','%Rosé Pey Blanc%','%Rosé Miraval%',
        '%Rouge Les Alexandrins%','%Rouge Grand Boise%',
        '%Blanc du Seuil%','%Blanc Galiniere%','%Blanc Montaurone%',
        -- Bière en verre (bouteille individuelle)
        '%Bière en verre%',
        -- Softs bouteille + eau
        '%Pepsi bouteille%','%Perrier grande%','%Jus de fruits%','%Cristaline%','%Schweppes%',
        -- Sirops
        '%Sirop de pêche%','%Sirop de menthe%','%Sirop de grenadine%','%Sirop de citron%','%Sirop Orgeat%'
      ]);
  END LOOP;
END $$;

-- ── Fiche Runner (roadmap zone) filtrée par profil d'espace ─────────────────
CREATE OR REPLACE FUNCTION get_zone_roadmap(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e UUID; v_s UUID; v_n TEXT; v_prof TEXT;
BEGIN
  SELECT * INTO v_e, v_s, v_n FROM _zone_resolve(p_token);
  IF v_e IS NULL THEN RETURN json_build_object('success', false, 'error', 'Session expirée'); END IF;
  v_prof := space_profile(v_n);
  RETURN json_build_object(
    'success', true,
    'dotations', (
      SELECT COALESCE(json_agg(json_build_object(
        'product_name', p.product_name, 'category', p.category, 'unit', p.unit,
        'planned_qty', rd.planned_qty, 'runner_status', rd.runner_status
      ) ORDER BY p.category, p.product_name), '[]'::json)
      FROM runner_dotations rd JOIN products p ON p.product_id = rd.product_id
      WHERE rd.event_id = v_e AND rd.space_id = v_s
        AND (v_prof = ANY(p.space_types) OR p.space_types IS NULL OR p.space_types = '{}')),
    'schedules', (
      SELECT COALESCE(json_agg(json_build_object(
        'staff_name', sc.staff_name, 'role', sc.role,
        'planned_arrival', sc.planned_arrival, 'planned_departure', sc.planned_departure
      ) ORDER BY sc.planned_arrival), '[]'::json)
      FROM schedules sc WHERE sc.event_id = v_e AND sc.space_id = v_s)
  );
END; $$;

GRANT EXECUTE ON FUNCTION get_zone_roadmap(TEXT) TO anon, authenticated;
