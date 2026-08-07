-- 20260707090054 — Correctifs sélecteur d'événement (Analyses).
-- 1) RG-003 : get_match_analysis expose cost_ht -> REVOKE PUBLIC/anon (grant auto de Postgres).
-- 2) get_events_list accepte 'seminaire' (clé UI) ET 'séminaire' (valeur DB accentuée),
--    sinon le sélecteur séminaire est vide alors que des séminaires clôturés existent.

-- RG-003 : get_match_analysis expose cost_ht → jamais à anon/PUBLIC.
revoke execute on function get_match_analysis(text) from public;
revoke execute on function get_match_analysis(text) from anon;
grant  execute on function get_match_analysis(text) to authenticated;

-- get_events_list : accepter 'seminaire' (clé UI sans accent) ET 'séminaire' (valeur DB).
create or replace function get_events_list(p_type text default 'match')
returns json language sql security definer set search_path to 'public' as $function$
  select coalesce(json_agg(json_build_object(
    'event_id', event_id, 'event_name', event_name, 'event_date', event_date) order by event_date desc),'[]'::json)
  from events
  where event_type = case when lower(p_type) in ('seminaire','séminaire') then 'séminaire'
                          else p_type end
    and status in ('clôturé','archivé');
$function$;
