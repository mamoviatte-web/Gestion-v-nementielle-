-- =====================================================================
-- Pièces jointes événements (feuilles de route séminaire, photos débrief)
-- À exécuter APRÈS schema.sql + rls_policies.sql.
--
-- NOTE (cohérence chemins Storage) : la convention de dossiers est
--   event-files/{event_id}/{space_id}/...
-- donc, pour le ROLE_RESPONSABLE, c'est le 2e segment qui porte le space_id.
-- La policy Storage ci-dessous vérifie (storage.foldername(name))[2]
-- (le prompt initial vérifiait [1], incompatible avec l'arborescence).
-- =====================================================================

create table if not exists event_attachments (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(event_id) on delete cascade,
  space_id        uuid references spaces(space_id),   -- NULL = pièce jointe globale
  attachment_type text not null check (attachment_type in
                    ('feuille_route_seminaire','rapport_photo_debrief','autre')),
  file_name       text not null,
  file_url        text not null,   -- chemin de l'objet dans le bucket event-files
  file_size_kb    int,
  mime_type       text,
  uploaded_by     text not null,
  uploaded_at     timestamptz default now(),
  comment         text
);

create index if not exists idx_attachments_event on event_attachments(event_id);
create index if not exists idx_attachments_space on event_attachments(space_id);

alter table debriefs add column if not exists has_photo_report boolean default false;

-- ─── RLS table ───────────────────────────────────────────────────────
alter table event_attachments enable row level security;

create policy stade_full_attachments on event_attachments
  for all using (is_stade()) with check (is_stade());

-- Responsable : lit les PJ de son espace + les PJ globales (space_id null)
create policy responsable_read_attachments on event_attachments
  for select using (
    app_role() = 'ROLE_RESPONSABLE'
    and (space_id = app_space_id() or space_id is null)
  );

-- Responsable : peut uploader UNIQUEMENT des photos débrief pour son espace
create policy responsable_upload_debrief_photo on event_attachments
  for insert with check (
    app_role() = 'ROLE_RESPONSABLE'
    and space_id = app_space_id()
    and attachment_type = 'rapport_photo_debrief'
  );

-- ─── Storage : bucket privé + policies ───────────────────────────────
insert into storage.buckets (id, name, public)
values ('event-files', 'event-files', false)
on conflict (id) do nothing;

create policy stade_storage_full on storage.objects
  for all using (
    bucket_id = 'event-files' and is_stade()
  ) with check (
    bucket_id = 'event-files' and is_stade()
  );

-- Responsable : accès au dossier de SON espace (2e segment = space_id)
create policy responsable_storage_own_space on storage.objects
  for all using (
    bucket_id = 'event-files'
    and app_role() = 'ROLE_RESPONSABLE'
    and (storage.foldername(name))[2] = app_space_id()::text
  ) with check (
    bucket_id = 'event-files'
    and app_role() = 'ROLE_RESPONSABLE'
    and (storage.foldername(name))[2] = app_space_id()::text
  );
