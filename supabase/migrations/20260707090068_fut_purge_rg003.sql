-- RG-003 : les purges de fûts exposent des coûts (pu_ht, cout_ht) et la vue
-- keg_summary expose unit_price_ht. get_event_purges était exécutable par anon
-- ET authenticated sans garde, et keg_summary sélectionnable par anon.
-- On garde get_event_purges (is_stade → [] sinon) + REVOKE anon, et on retire
-- le SELECT anon sur keg_summary (aucun écran anon ne la consomme ; seuls les
-- écrans admin ROLE_STADE l'utilisent).

CREATE OR REPLACE FUNCTION get_event_purges(p_event uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  select case when not is_stade() then '[]'::json else (
    select coalesce(json_agg(json_build_object(
       'product_id',esl.product_id,'produit',p.product_name,'qty',esl.initial_qty,
       'pu_ht',p.unit_price_ht,'cout_ht',round(esl.consumption_cost_ht,2)) order by p.product_name),'[]'::json)
    from event_stock_lines esl
    join products p on p.product_id=esl.product_id
    join spaces s on s.space_id=esl.space_id and s.space_name='Purge tireuses'
    where esl.event_id=p_event and esl.initial_qty>0
  ) end;
$fn$;

REVOKE EXECUTE ON FUNCTION get_event_purges(uuid) FROM anon, public;
REVOKE SELECT ON keg_summary FROM anon;
