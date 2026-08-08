-- 20260707090059 — Figer le coût RH à la clôture (trigger).
-- RG-003 : get_event_rh déjà révoqué de PUBLIC/anon (coûts RH).
create or replace function freeze_event_rh_cost() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status in ('clôturé','archivé') and (old.status is distinct from new.status) then
    new.total_rh_cost := coalesce((get_event_rh(new.event_id)->'kpis'->>'cout_rh_ht')::numeric, new.total_rh_cost, 0);
  end if;
  return new;
end $$;

drop trigger if exists trg_freeze_event_rh_cost on events;
create trigger trg_freeze_event_rh_cost
  before update on events for each row execute function freeze_event_rh_cost();

-- RG-003 : get_event_rh expose des coûts RH → jamais anon/PUBLIC.
revoke execute on function get_event_rh(uuid) from public;
revoke execute on function get_event_rh(uuid) from anon;
grant execute on function get_event_rh(uuid) to authenticated;
