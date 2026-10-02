-- Forfaits RH par événement : montants forfaitaires (freelance, manutention…)
-- non liés à des heures, intégrés au coût RH de l'événement (KPI RH de l'onglet
-- « RH & horaires »). Complète occasional_hours (heures) et schedules (régie).
-- RG-003 : coûts réservés ROLE_STADE (policy is_stade()).

create table if not exists event_rh_forfaits (
  forfait_id uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(event_id) on delete cascade,
  label      text not null,
  category   text not null default 'autre'
             check (category in ('freelance', 'manutention', 'autre')),
  amount_ht  numeric(10,2) not null check (amount_ht >= 0),
  note       text,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_event_rh_forfaits_event on event_rh_forfaits(event_id);

alter table event_rh_forfaits enable row level security;

-- ROLE_STADE uniquement (même pattern que occasional_hours).
drop policy if exists stade_forfaits on event_rh_forfaits;
create policy stade_forfaits on event_rh_forfaits
  for all using (is_stade()) with check (is_stade());

grant select, insert, update, delete on event_rh_forfaits to authenticated;
