-- Club 70 Sud aligné à l'identique sur Club 70 Nord (décision utilisateur)
-- ============================================================================
-- Le CDC V7 définissait Club 70 Sud plus léger que Nord (pas de 2e blanc, pas
-- de sirops, pas de Ricard). L'exploitant demande que les deux Club 70 aient
-- STRICTEMENT le même assortiment. On aligne donc Sud sur Nord.
--
-- Sud était un sous-ensemble strict de Nord : on ajoute à Sud les 6 produits
-- présents à Nord et absents de Sud (tous niveau S), aux mêmes familles :
--   Blanc Montaurone (Vins), Ricard classique (Spiritueux), et les sirops
--   Orgeat / citron / grenadine / pêche (Softs).
-- Additif et idempotent (NOT EXISTS). cdc_version 'V7+' = écart assumé au CDC.

insert into area_product_reference
  (area_name, area_group, product_name, product_family, association_level, product_id, cdc_version)
select 'Club 70 Sud', 'VIP', v.pname, v.fam, 'S', v.pid::uuid, 'V7+'
from (values
  ('Blanc Montaurone',   'Vins',                   '6cc890cc-ad92-49ce-ae90-1ab60909d92c'),
  ('Ricard classique',   'Spiritueux / Apéritifs', '40de0dac-e3e4-409f-8fef-5c87234490cc'),
  ('Sirop Orgeat',       'Softs / Eau / Sirops',   '651fce04-bf3f-4d3e-a1d7-ddd4a05a6afe'),
  ('Sirop de citron',    'Softs / Eau / Sirops',   '69217d5b-a1c1-4764-ad95-5417f29ad52d'),
  ('Sirop de grenadine', 'Softs / Eau / Sirops',   'dec7af25-40d4-4a4d-b7d3-deed6d6b108c'),
  ('Sirop de pêche',     'Softs / Eau / Sirops',   'c430ebe8-e635-48e3-b41f-aa1b30303d61')
) as v(pname, fam, pid)
where not exists (
  select 1 from area_product_reference r
  where upper(btrim(r.area_name)) = 'CLUB 70 SUD'
    and r.product_id = v.pid::uuid
);
