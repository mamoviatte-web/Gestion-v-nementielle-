-- RG-003 : get_event_occasional expose taux/coût des prestations runner mais
-- était exécutable par anon/authenticated sans garde → garde is_stade() ([] sinon)
-- + REVOKE anon. Réservé ROLE_STADE (comme get_event_rh / get_event_pl).
CREATE OR REPLACE FUNCTION get_event_occasional(p_event uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  select case when not is_stade() then '[]'::json else (
    select coalesce(json_agg(json_build_object(
      'id',id,'staff_name',staff_name,'mission',mission_type,'date',work_date,
      'start',start_time,'end',end_time,'hours',hours_worked,'rate',hourly_rate,'cost',total_cost
    ) order by work_date, staff_name),'[]'::json)
    from occasional_hours where event_id=p_event
  ) end;
$fn$;
REVOKE EXECUTE ON FUNCTION get_event_occasional(uuid) FROM anon, public;
