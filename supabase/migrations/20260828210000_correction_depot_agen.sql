-- Correction du dépôt suite au match Agen (départ manquant + double retour)
-- ============================================================================
-- Avant les correctifs de fiabilité, le dépôt d'Agen a été faussé à la hausse :
-- le départ (sortie à l'ouverture) n'a jamais été enregistré, et le retour a été
-- compté deux fois. On rétablit l'inventaire réel pour repartir d'une base fiable.
--
-- Correction (basée sur les mouvements réels, hors fûts/CO2 gérés par le keg) :
--   correction = −Σinitial(espaces non conservés) + Σfinal − Σretours réels
-- Appliquée au solde dépôt + mouvement 'correction' tracé (RG-002). Idempotent.

do $$
declare rec record; v_agen uuid := '5b999a21-25e6-4fb3-babc-d89cf69e2e27'; v_n int := 0;
begin
  if exists (select 1 from stock_movements where event_id=v_agen and movement_type='correction') then
    raise notice 'Correction dépôt Agen déjà appliquée — aucune action.';
    return;
  end if;
  perform set_config('app.allow_adjustment','on', true);

  for rec in
    with nonret as (
      select esl.product_id, sum(esl.initial_qty) sinit, sum(esl.final_qty) sfinal
      from event_stock_lines esl join spaces s on s.space_id=esl.space_id
      where esl.event_id=v_agen and esl.final_qty is not null and coalesce(s.retains_stock,false)=false
      group by esl.product_id),
    ret as (
      select product_id, sum(qty) sret from stock_movements
      where event_id=v_agen and movement_type in ('retour','retour_réutilisable') group by product_id)
    select n.product_id, pdr.depot_id,
      (-coalesce(n.sinit,0) + coalesce(n.sfinal,0) - coalesce(r.sret,0)) correction
    from nonret n
    join products p on p.product_id=n.product_id
    join product_depot_routing pdr on pdr.product_id=n.product_id
    join stock_balances b on b.product_id=n.product_id and b.location_id=pdr.depot_id
    left join ret r on r.product_id=n.product_id
    where p.unit <> 'fût' and p.product_name not ilike 'CO2%'
  loop
    if coalesce(rec.correction,0) = 0 then continue; end if;
    update stock_balances set current_quantity = greatest(0, current_quantity + rec.correction), last_movement_at=now()
      where product_id=rec.product_id and location_id=rec.depot_id;
    insert into stock_movements(event_id, product_id, space_id, movement_type, qty, from_location_id, responsable_nom, event_category, status)
      values (v_agen, rec.product_id, null, 'correction', abs(rec.correction), rec.depot_id,
              'Correction dépôt Agen (départ manquant + double retour) — régie', 'match', 'validated');
    v_n := v_n + 1;
  end loop;
  raise notice 'Correction dépôt Agen : % produits ajustés.', v_n;
end $$;
