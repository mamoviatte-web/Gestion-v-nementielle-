-- Intégration consommation PMR — match Agen (relevé régie Stocks_AGEN)
-- PMR = espace terrasse/PMR (buvette). Corrige les chiffres partiels existants
-- avec le relevé régie. Même procédure guardée/idempotente que les autres espaces.
do $$
declare v_agen uuid := '5b999a21-25e6-4fb3-babc-d89cf69e2e27';
        v_resp text := 'Intégration PMR « réalité match » Agen — régie';
begin
  if exists (select 1 from stock_movements where event_id=v_agen and responsable_nom=v_resp) then
    raise notice 'Intégration PMR Agen déjà appliquée — aucune action.'; return; end if;
  perform set_config('app.allow_adjustment','on', true);
  alter table event_stock_lines disable trigger trg_initial_entered;
  alter table event_stock_lines disable trigger trg_reassort_updated;
  alter table event_stock_lines disable trigger trg_stock_final_entered;
  alter table event_stock_lines disable trigger trg_guard_close_requires_opening;
  create temp table _tgt(space_id uuid, product_id uuid, i int, r int, f int, cu numeric) on commit drop;
  insert into _tgt(space_id,product_id,i,r,f,cu) values
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'00755134-7027-4ae9-be41-9f953c5eab30'::uuid,2,0,0,8.7),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'f81b4b03-afa9-49eb-bde2-022fa61cb949'::uuid,2,0,1,6.9),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'792eefa4-2c85-4fdb-8c16-93873c61fbbb'::uuid,72,30,0,1.36),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'800e26a7-5d25-4a2e-96eb-feabac36fe1a'::uuid,6,0,0,1.83),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'e4f25bc7-dd41-4036-aff6-877c925e1679'::uuid,6,0,2,1.05),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'0a6b296e-57e1-4354-bfe0-2f6f210660a5'::uuid,2,0,0,2.6),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'271f1cdb-49c6-4bd0-a029-d5f839bfc84a'::uuid,120,20,0,0.17),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'1ed609ab-e199-4f77-ac11-5ed69bf11a14'::uuid,60,0,51,1.73),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'49be0b87-8478-46a0-826e-6db527f51c64'::uuid,36,0,22,1.8),
    ('5a074fb1-07a5-4dda-b905-cdff59942fa0'::uuid,'a30dc8cb-a922-46e3-8f75-7f928407acde'::uuid,72,0,0,1.48);
  insert into stock_movements(event_id,product_id,space_id,movement_type,qty,responsable_nom,event_category,status)
  select v_agen,t.product_id,t.space_id,'inventaire',abs((t.i+t.r-t.f)-coalesce(l.consumed_qty,0)),v_resp,'match','validated'
  from _tgt t left join event_stock_lines l on l.event_id=v_agen and l.space_id=t.space_id and l.product_id=t.product_id
  where (t.i+t.r-t.f) <> coalesce(l.consumed_qty,0);
  insert into event_stock_lines(event_id,space_id,product_id,initial_qty,reassort_qty,final_qty,frozen_unit_price_ht,anomaly_comment,responsable_nom,submitted_at)
  select v_agen,t.space_id,t.product_id,t.i,t.r,t.f,t.cu,
    case when (t.i+t.r-t.f)<0 then 'Conso négative — relevé régie Agen (stock final > entrées)' else null end,v_resp,now()
  from _tgt t
  on conflict (event_id,space_id,product_id) do update set
    initial_qty=excluded.initial_qty,reassort_qty=excluded.reassort_qty,final_qty=excluded.final_qty,
    frozen_unit_price_ht=excluded.frozen_unit_price_ht,anomaly_comment=excluded.anomaly_comment,
    responsable_nom=excluded.responsable_nom,submitted_at=now();
  alter table event_stock_lines enable trigger trg_initial_entered;
  alter table event_stock_lines enable trigger trg_reassort_updated;
  alter table event_stock_lines enable trigger trg_stock_final_entered;
  alter table event_stock_lines enable trigger trg_guard_close_requires_opening;
end $$;
