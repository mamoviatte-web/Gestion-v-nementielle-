-- =====================================================================
-- Suppression d'événements : cascade DB + RLS + réparation de chaîne.
-- Idempotent et tolérant aux tables non encore créées (modules runner /
-- pièces jointes). À exécuter quand l'accès DB est disponible.
-- =====================================================================

-- ─── FK enfant → ON DELETE CASCADE (pour les tables présentes) ───────
do $$
declare t text;
begin
  foreach t in array array[
    'event_spaces','runner_dotations','event_stock_lines','stock_movements',
    'provider_presence','schedules','debriefs',
    'event_consumptions','runner_auto_planning','event_attachments'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I drop constraint if exists %I', t, t || '_event_id_fkey');
      execute format(
        'alter table public.%I add constraint %I foreign key (event_id) references events(event_id) on delete cascade',
        t, t || '_event_id_fkey');
    end if;
  end loop;
end $$;

-- ─── previous_event_id → ON DELETE SET NULL (si la colonne existe) ───
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'previous_event_id'
  ) then
    alter table events drop constraint if exists events_previous_event_id_fkey;
    alter table events add constraint events_previous_event_id_fkey
      foreign key (previous_event_id) references events(event_id) on delete set null;
  end if;
end $$;

-- ─── RLS : suppression réservée au ROLE_STADE ────────────────────────
drop policy if exists stade_delete_events on events;
create policy stade_delete_events on events
  for delete using (is_stade());

-- ─── Réparation de la chaîne des matchs après suppression ────────────
create or replace function repair_match_chain()
returns void
language plpgsql
set search_path = public
as $$
declare
  ev record;
  prev_id uuid;
begin
  for ev in
    select event_id, event_date from events
    where event_type = 'match' and previous_event_id is null
    order by event_date asc
  loop
    select event_id into prev_id
    from events
    where event_type = 'match'
      and event_date < ev.event_date
      and event_id <> ev.event_id
    order by event_date desc limit 1;

    if prev_id is not null then
      update events set previous_event_id = prev_id where event_id = ev.event_id;
    end if;
  end loop;
end;
$$;
