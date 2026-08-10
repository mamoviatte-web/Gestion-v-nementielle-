-- RG-003 : get_event_pl expose les coûts F&B/RH et la marge, mais était
-- exécutable par anon ET authenticated sans garde → fuite vers anon et les 16
-- comptes ROLE_RESPONSABLE. On ajoute le garde is_stade() (charge sans coûts
-- pour les non-stade) et on retire l'exécution à anon. Le compte de résultat
-- est réservé ROLE_STADE.

CREATE OR REPLACE FUNCTION get_event_pl(p_event uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  select case when not is_stade()
    then json_build_object(
      'recettes_ht',null,'recettes_ttc',null,'nb_ventes',0,
      'cout_fb_ht',null,'cout_rh_ht',null,'marge_ht',null,'marge_pct',null,
      'panier_moyen',null,'recette_par_pax',null,'par_pos','[]'::json,'par_type','[]'::json)
    else (
      with r as (select * from event_revenue where event_id=p_event),
      agg as (select coalesce(sum(revenue_ht),0) rht, coalesce(sum(revenue_ttc),0) rttc, coalesce(sum(nb_ventes),0) nv from r),
      e as (select coalesce(total_fb_cost_ht,0) fb, coalesce(total_rh_cost,0) rh, coalesce(expected_attendees,0) pax from events where event_id=p_event),
      bytype as (select pos_type, sum(revenue_ht) ht, sum(revenue_ttc) ttc from r group by pos_type)
      select json_build_object(
        'recettes_ht', round((select rht from agg),2),
        'recettes_ttc', round((select rttc from agg),2),
        'nb_ventes', (select nv from agg),
        'cout_fb_ht', (select fb from e),
        'cout_rh_ht', (select rh from e),
        'marge_ht', round((select rht from agg) - (select fb from e) - (select rh from e),2),
        'marge_pct', (select case when (select rht from agg)>0
                        then round(100.0*((select rht from agg)-(select fb+rh from e))/(select rht from agg),1) else 0 end),
        'panier_moyen', (select case when (select nv from agg)>0 then round((select rttc from agg)/(select nv from agg),2) else 0 end),
        'recette_par_pax', (select case when (select pax from e)>0 then round((select rht from agg)/(select pax from e),2) else 0 end),
        'par_pos', (select coalesce(json_agg(json_build_object('label',pos_label,'type',pos_type,'ht',round(revenue_ht,2),'ttc',round(revenue_ttc,2),'ventes',nb_ventes) order by revenue_ht desc nulls last),'[]'::json) from r),
        'par_type', (select coalesce(json_agg(json_build_object('type',pos_type,'ht',round(ht,2),'ttc',round(ttc,2)) order by ht desc),'[]'::json) from bytype)
      )
    )
  end;
$fn$;

REVOKE EXECUTE ON FUNCTION get_event_pl(uuid) FROM anon, public;
