-- =====================================================================
-- Chaînage automatique des matchs (continuité stocks + référence runner)
-- À exécuter APRÈS schema.sql + rls_policies.sql.
-- =====================================================================

alter table events add column if not exists previous_event_id uuid references events(event_id);
alter table events add column if not exists sequence_number int;

-- ─── Chaînage au moment de l'INSERT (match → match précédent) ────────
create or replace function link_previous_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  prev_id uuid;
  prev_seq int;
begin
  if new.event_type = 'match' then
    select event_id, sequence_number into prev_id, prev_seq
    from events
    where event_type = 'match'
      and event_date < new.event_date
      and event_id <> new.event_id
    order by event_date desc
    limit 1;

    new.previous_event_id := prev_id;
    new.sequence_number := coalesce(prev_seq, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_previous_match on events;
create trigger trg_link_previous_match
  before insert on events
  for each row execute function link_previous_match();

-- ─── Rattachement du match suivant (insertion antidatée) ─────────────
create or replace function relink_following_match()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.event_type = 'match' then
    update events
    set previous_event_id = new.event_id,
        sequence_number = coalesce(new.sequence_number, 0) + 1
    where event_type = 'match'
      and event_id = (
        select event_id from events
        where event_type = 'match' and event_date > new.event_date
        order by event_date asc limit 1
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_relink_following_match on events;
create trigger trg_relink_following_match
  after insert on events
  for each row execute function relink_following_match();

-- ─── Vue : continuité des stocks entre deux matchs ───────────────────
create or replace view stock_continuity_check
with (security_invoker = true) as
select
  e.event_id,
  e.event_name,
  e.previous_event_id,
  pe.event_name as previous_event_name,
  esl.space_id,
  s.space_name,
  esl.product_id,
  p.product_name,
  esl.initial_qty as current_initial_qty,
  prev_esl.final_qty as previous_final_qty,
  (esl.initial_qty - coalesce(prev_esl.final_qty, 0)) as stock_gap,
  case
    when prev_esl.final_qty is null then 'aucune_donnee_precedente'
    when esl.initial_qty = prev_esl.final_qty then 'coherent'
    when esl.initial_qty > prev_esl.final_qty then 'ecart_positif_a_justifier'
    else 'ecart_negatif_a_justifier'
  end as continuity_status
from events e
join event_stock_lines esl on esl.event_id = e.event_id
join spaces s on s.space_id = esl.space_id
join products p on p.product_id = esl.product_id
left join events pe on pe.event_id = e.previous_event_id
left join event_stock_lines prev_esl
  on prev_esl.event_id = e.previous_event_id
  and prev_esl.space_id = esl.space_id
  and prev_esl.product_id = esl.product_id
where e.event_type = 'match';

-- ─── Chaînage rétroactif des données existantes (Vannes → Montauban) ─
update events set sequence_number = 1
where event_name = 'Provence Rugby vs Vannes';

update events
set previous_event_id = (select event_id from events where event_name = 'Provence Rugby vs Vannes'),
    sequence_number = 2
where event_name = 'Provence Rugby vs Montauban';
