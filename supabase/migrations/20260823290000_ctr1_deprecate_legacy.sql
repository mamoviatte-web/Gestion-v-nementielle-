-- CTR-1 Phase 3.4 — marquage @deprecated des objets legacy (source unique = catalogue)
-- ============================================================================
-- Depuis la bascule (space_product_catalog source unique + area_product_reference
-- devenue une vue), plus aucun lecteur applicatif n'utilise ces objets. On les
-- marque @deprecated pour observation avant suppression définitive. Aucun DROP
-- ici : marquage documentaire uniquement (zéro impact runtime).
--
-- CONSERVÉS (lecteurs/écrivains vivants — NE PAS déprécier) :
--   generate_runner_dotations, get_runner_sheet, get_runner_pdf_data,
--   get_buvette_runner, get_buvette_runners_index, get_zone_stock,
--   get_zone_buvette_stock, v_space_dotation_recommendations,
--   compute_space_coefficients, reset_all_coefficients (bouton Coefficients),
--   sync_catalog_complement, apr_view_insert/delete/update (triggers de la vue).

comment on function public.get_runner_sheet_by_area(text, text)
  is '@deprecated CTR-1 — remplacé par get_runner_sheet (lecture catalogue par space_id). Plus aucun appelant applicatif.';
comment on function public.get_recommended_dotation(uuid)
  is '@deprecated CTR-1 — logique reprise par generate_runner_dotations (catalogue). Plus aucun appelant applicatif.';
comment on function public.get_dotations_pax_adjusted(uuid, uuid)
  is '@deprecated CTR-1 — ajustement PAX intégré à generate_runner_dotations. Plus aucun appelant applicatif.';
comment on function public.inject_cdc_v3()
  is '@deprecated CTR-1 — seed historique du référentiel, superseded par space_product_catalog. Conservé pour archive.';
comment on function public.inject_5match_coefficients()
  is '@deprecated CTR-1 — seed coefficients historique, superseded par compute_space_coefficients. Conservé pour archive.';

comment on view public.v_runner_sheet
  is '@deprecated CTR-1 — vue legacy non lue par l''appli (lecteurs sur catalogue).';
comment on view public.v_profile_avg
  is '@deprecated CTR-1 — vue de profilage legacy, non lue par l''appli.';
comment on view public.v_buvette_profile_avg
  is '@deprecated CTR-1 — vue de profilage buvette legacy, non lue par l''appli.';
