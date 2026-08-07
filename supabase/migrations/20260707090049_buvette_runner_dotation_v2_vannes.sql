-- ══ Ingestion match VANNES (clôturé, is_simulation=false) → event_stock_lines ══
INSERT INTO events (event_id, event_name, event_type, event_date, status, is_simulation)
SELECT gen_random_uuid(), 'Vannes', 'match', DATE '2026-05-03', 'clôturé', false
WHERE NOT EXISTS (SELECT 1 FROM events WHERE event_name='Vannes');

INSERT INTO event_spaces (event_id, space_id)
SELECT ev.id, s.space_id
FROM (SELECT event_id id FROM events WHERE event_name='Vannes' LIMIT 1) ev
JOIN spaces s ON s.service_type='buvette' AND s.space_name ~ '^B[1-9]$'
ON CONFLICT (event_id, space_id) DO NOTHING;

WITH src(code, pname, init, reassort, fin) AS (VALUES
    ('B1','Fût Bud',8,0,2),
    ('B1','Fût Leffe',4,0,0),
    ('B1','Fût Hoegaarden Blanche',4,0,0),
    ('B1','Fût Goose Island IPA',4,0,0),
    ('B1','CO2',2,0,0),
    ('B1','Pepsi 50cl',34,0,7),
    ('B1','Orangina 50cl',9,0,0),
    ('B1','Ice Tea 50cl',35,0,4),
    ('B1','Cristalline 50cl',43,0,5),
    ('B1','San Pellegrino 50cl',26,0,1),
    ('B1','Sirop de pêche',1,0,0),
    ('B1','Sirop de menthe',0,0,0),
    ('B1','Sirop de grenadine',1,0,0),
    ('B1','Sirop de citron',0,0,0),
    ('B2','Fût Bud',6,0,3),
    ('B2','Fût Leffe',4,0,1),
    ('B2','Fût Hoegaarden Blanche',3,0,1),
    ('B2','Fût Goose Island IPA',4,0,0),
    ('B2','CO2',0,0,0),
    ('B2','Pepsi 50cl',39,0,1),
    ('B2','Orangina 50cl',22,0,6),
    ('B2','Ice Tea 50cl',24,0,7),
    ('B2','Cristalline 50cl',47,0,2),
    ('B2','San Pellegrino 50cl',28,0,1),
    ('B2','Sirop de pêche',1,0,0),
    ('B2','Sirop de menthe',0,0,0),
    ('B2','Sirop de grenadine',1,0,0),
    ('B2','Sirop de citron',0,0,0),
    ('B3','Fût Bud',7,0,4),
    ('B3','Fût Leffe',3,0,0),
    ('B3','Fût Hoegaarden Blanche',3,0,0),
    ('B3','Fût Goose Island IPA',4,0,1),
    ('B3','CO2',0,0,0),
    ('B3','Pepsi 50cl',36,0,21),
    ('B3','Orangina 50cl',36,0,15),
    ('B3','Ice Tea 50cl',31,0,11),
    ('B3','Cristalline 50cl',45,0,0),
    ('B3','San Pellegrino 50cl',41,0,23),
    ('B3','Sirop de pêche',2,0,1),
    ('B3','Sirop de menthe',3,0,3),
    ('B3','Sirop de grenadine',1,0,1),
    ('B3','Sirop de citron',0,0,0),
    ('B4','Fût Bud',6,0,0),
    ('B4','Fût Leffe',4,0,1),
    ('B4','Fût Hoegaarden Blanche',5,0,1),
    ('B4','Fût Goose Island IPA',4,0,3),
    ('B4','CO2',0,0,0),
    ('B4','Pepsi 50cl',32,0,19),
    ('B4','Orangina 50cl',30,0,13),
    ('B4','Ice Tea 50cl',28,12,10),
    ('B4','Cristalline 50cl',48,0,1),
    ('B4','San Pellegrino 50cl',48,0,7),
    ('B4','Sirop de pêche',1,0,0),
    ('B4','Sirop de menthe',0,0,0),
    ('B4','Sirop de grenadine',1,0,0),
    ('B4','Sirop de citron',0,0,0),
    ('B5','Fût Bud',3,0,0),
    ('B5','Fût Leffe',2,0,0),
    ('B5','Fût Hoegaarden Blanche',0,0,0),
    ('B5','Fût Goose Island IPA',0,0,0),
    ('B5','CO2',1,0,0),
    ('B5','Pepsi 50cl',0,0,0),
    ('B5','Orangina 50cl',0,0,0),
    ('B5','Ice Tea 50cl',0,0,0),
    ('B5','Cristalline 50cl',0,0,0),
    ('B5','San Pellegrino 50cl',0,0,0),
    ('B5','Sirop de pêche',1,0,0),
    ('B5','Sirop de menthe',0,0,0),
    ('B5','Sirop de grenadine',0,0,0),
    ('B5','Sirop de citron',0,0,0),
    ('B6','Fût Bud',6,0,1),
    ('B6','Fût Leffe',4,0,1),
    ('B6','Fût Hoegaarden Blanche',3,0,1),
    ('B6','Fût Goose Island IPA',4,0,1),
    ('B6','CO2',1,0,0),
    ('B6','Pepsi 50cl',24,12,1),
    ('B6','Orangina 50cl',15,12,10),
    ('B6','Ice Tea 50cl',20,12,16),
    ('B6','Cristalline 50cl',24,0,6),
    ('B6','San Pellegrino 50cl',18,0,0),
    ('B6','Sirop de pêche',1,0,0),
    ('B6','Sirop de menthe',0,0,0),
    ('B6','Sirop de grenadine',1,0,0),
    ('B6','Sirop de citron',0,0,0),
    ('B7','Fût Bud',5,0,2),
    ('B7','Fût Leffe',3,0,2),
    ('B7','Fût Hoegaarden Blanche',3,0,2),
    ('B7','Fût Goose Island IPA',4,0,1),
    ('B7','CO2',0,0,0),
    ('B7','Pepsi 50cl',17,0,2),
    ('B7','Orangina 50cl',17,0,5),
    ('B7','Ice Tea 50cl',20,0,12),
    ('B7','Cristalline 50cl',23,0,6),
    ('B7','San Pellegrino 50cl',23,0,10),
    ('B7','Sirop de pêche',1,0,0),
    ('B7','Sirop de menthe',0,0,0),
    ('B7','Sirop de grenadine',1,0,0),
    ('B7','Sirop de citron',0,0,0),
    ('B8','Fût Bud',3,0,1),
    ('B8','Fût Leffe',2,0,0),
    ('B8','Fût Fada Blanche',0,0,0),
    ('B8','Fût Fada IPA',0,0,0),
    ('B8','CO2',6,0,6),
    ('B8','Lillet Blanc',4,0,0),
    ('B8','Lillet Rosé',0,0,0),
    ('B8','Tonic',5,0,1),
    ('B8','Perrier grande bouteille',0,0,0),
    ('B8','Pepsi 50cl',24,0,2),
    ('B8','Orangina 50cl',24,0,19),
    ('B8','Ice Tea 50cl',24,0,8),
    ('B8','Cristalline 50cl',24,0,5),
    ('B8','San Pellegrino 50cl',24,0,17),
    ('B8','Sirop de pêche',1,0,0),
    ('B8','Sirop de menthe',0,0,0),
    ('B8','Sirop de grenadine',1,0,0),
    ('B8','Sirop de citron',0,0,0),
    ('B9','Fût Bud',7,0,2),
    ('B9','Fût Leffe',3,0,2),
    ('B9','Fût Hoegaarden Blanche',3,0,1),
    ('B9','Fût Goose Island IPA',4,0,1),
    ('B9','CO2',1,0,0),
    ('B9','Pepsi 50cl',24,0,0),
    ('B9','Orangina 50cl',22,0,15),
    ('B9','Ice Tea 50cl',23,0,0),
    ('B9','Cristalline 50cl',25,0,14),
    ('B9','San Pellegrino 50cl',24,0,18),
    ('B9','Sirop de pêche',1,0,0),
    ('B9','Sirop de menthe',0,0,0),
    ('B9','Sirop de grenadine',1,0,0),
    ('B9','Sirop de citron',8,0,7)
)
INSERT INTO event_stock_lines (event_id, space_id, product_id, initial_qty, reassort_qty, final_qty, responsable_nom)
SELECT ev.id, s.space_id, apr.product_id, src.init, src.reassort, src.fin, 'Import Vannes'
FROM src
CROSS JOIN (SELECT event_id id FROM events WHERE event_name='Vannes' LIMIT 1) ev
JOIN spaces s ON s.space_name = src.code AND s.service_type='buvette'
JOIN area_product_reference apr ON apr.area_name = src.code
  AND lower(trim(apr.product_name)) = lower(trim(src.pname)) AND apr.product_id IS NOT NULL
ON CONFLICT (event_id, space_id, product_id) DO UPDATE
  SET initial_qty=EXCLUDED.initial_qty, reassort_qty=EXCLUDED.reassort_qty, final_qty=EXCLUDED.final_qty;

-- Recalcul des coefficients (les buvettes obtiennent des lignes 'computed' réelles).
SELECT compute_space_coefficients();

-- Moyenne du profil buvette (fallback niveau 2 de la cascade).
CREATE OR REPLACE VIEW v_buvette_profile_avg AS
SELECT spc.product_id, ROUND(AVG(spc.avg_consumption)::numeric, 2) AS profile_avg_conso
FROM space_product_coefficients spc
JOIN spaces s ON s.space_id = spc.space_id
WHERE s.service_type = 'buvette' AND spc.avg_consumption > 0
GROUP BY spc.product_id;

-- ══ Runner v2 : dotation « à monter » jamais vide sur un socle (cascade réel→profil→plancher) ══
CREATE OR REPLACE FUNCTION get_buvette_runner(p_buvette_code text, p_event_id uuid, p_show_level text DEFAULT 'S')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_levels text[]; v_space_id uuid; v_libelle text; v_result json;
BEGIN
  v_levels := CASE upper(p_show_level)
    WHEN 'S' THEN ARRAY['S'] WHEN 'SR' THEN ARRAY['S','R']
    WHEN 'SRP' THEN ARRAY['S','R','P'] WHEN 'ALL' THEN ARRAY['S','R','P','C'] ELSE ARRAY['S'] END;
  SELECT space_id INTO v_space_id FROM spaces
    WHERE service_type='buvette' AND upper(trim(space_name))=upper(trim(p_buvette_code)) LIMIT 1;
  SELECT max(legacy_area_name) INTO v_libelle FROM area_product_reference WHERE area_name=upper(p_buvette_code);
  SELECT json_build_object(
    'buvette_code', upper(p_buvette_code), 'libelle', v_libelle,
    'event_id', p_event_id, 'show_level', upper(p_show_level),
    'lines', COALESCE(json_agg(l ORDER BY l.family_rank, l.association_level, l.product_name), '[]'::json)
  ) INTO v_result
  FROM (
    SELECT apr.product_family, apr.product_name, apr.association_level, apr.is_default,
      bsl.depot_label, bsl.depot_type,
      ROUND(COALESCE(spc.coefficient, 1.00)::numeric, 2) AS coeff,
      COALESCE(spc.avg_consumption, 0) AS moy_hist,
      COALESCE(esl.initial_qty, 0) AS stock_espace,
      -- Cascade : réel espace → moyenne profil buvette → plancher (socle seulement)
      CEIL(
        COALESCE(
          spc.avg_consumption,
          pa.profile_avg_conso,
          CASE WHEN apr.association_level='S' THEN
            CASE apr.product_family
              WHEN 'Bière / Fûts' THEN 2 WHEN 'Softs / Eau / Sirops' THEN 12
              WHEN 'Gaz / Technique' THEN 1 ELSE 2 END
          ELSE 0 END
        ) * 1.20 * 1.0   -- facteur PAX neutre (levier futur : pax_event / pax_référence)
      )::int AS a_monter,
      CASE WHEN spc.avg_consumption IS NOT NULL THEN 'reel'
           WHEN pa.profile_avg_conso IS NOT NULL THEN 'profil'
           WHEN apr.association_level='S' THEN 'plancher' ELSE 'option' END AS dotation_source,
      CASE apr.product_family WHEN 'Bière / Fûts' THEN 1 WHEN 'Vins' THEN 2 WHEN 'Champagne' THEN 3
        WHEN 'Softs / Eau / Sirops' THEN 4 WHEN 'Spiritueux / Apéritifs' THEN 5 WHEN 'Gaz / Technique' THEN 6 ELSE 7 END AS family_rank
    FROM area_product_reference apr
    LEFT JOIN buvette_stock_locations bsl ON bsl.area_name=apr.area_name AND bsl.product_family=apr.product_family
    LEFT JOIN space_product_coefficients spc ON spc.space_id=v_space_id AND spc.product_id=apr.product_id
    LEFT JOIN v_buvette_profile_avg pa ON pa.product_id=apr.product_id
    LEFT JOIN event_stock_lines esl ON esl.event_id=p_event_id AND esl.product_id=apr.product_id AND esl.space_id=v_space_id
    WHERE apr.area_name=upper(p_buvette_code) AND apr.association_level = ANY(v_levels)
      AND NOT (upper(p_buvette_code)<>'B8' AND apr.product_family IN ('Vins','Champagne','Spiritueux / Apéritifs'))
  ) l;
  RETURN v_result;
END $$;
GRANT EXECUTE ON FUNCTION get_buvette_runner(text,uuid,text) TO authenticated;
