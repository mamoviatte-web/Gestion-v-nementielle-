-- ═══════════════════════════════════════════════════════════════════════════
-- debrief_photos.sql — galerie photos illimitée rattachée au débrief
-- RLS via helpers projet is_stade() / app_role() / app_space_id()
-- (le prompt utilisait auth.jwt()->... ; on garde le standard du projet).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS debrief_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  space_id     UUID REFERENCES spaces(space_id) ON DELETE SET NULL,
  photo_type   TEXT NOT NULL CHECK (photo_type IN ('mise_en_place','fb','fin_evenement','incident','autre')),
  storage_path TEXT NOT NULL,
  public_url   TEXT,
  caption      TEXT,
  taken_by     TEXT,
  taken_at     TIMESTAMPTZ DEFAULT now(),
  file_size_kb INT,
  width_px     INT,
  height_px    INT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debrief_photos_event ON debrief_photos(event_id, photo_type);

-- RLS : les débriefs zone (match & séminaire) passent par un flux ANON (accès
-- par token, sans login). Les policies is_stade()/app_role() bloqueraient donc
-- l'upload côté terrain. On ouvre à anon + authenticated (photos de débrief non
-- sensibles, rattachées à un event_id). ROLE_STADE garde évidemment l'accès.
ALTER TABLE debrief_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_full_debrief_photos ON debrief_photos;
DROP POLICY IF EXISTS responsable_insert_photos ON debrief_photos;
DROP POLICY IF EXISTS responsable_read_photos ON debrief_photos;
DROP POLICY IF EXISTS responsable_delete_photos ON debrief_photos;
DROP POLICY IF EXISTS debrief_photos_read ON debrief_photos;
DROP POLICY IF EXISTS debrief_photos_insert ON debrief_photos;
DROP POLICY IF EXISTS debrief_photos_delete ON debrief_photos;
CREATE POLICY debrief_photos_read   ON debrief_photos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY debrief_photos_insert ON debrief_photos FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY debrief_photos_delete ON debrief_photos FOR DELETE TO anon, authenticated USING (true);

-- ── Bucket Storage (privé, 20 Mo, images) ──────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('debrief-photos','debrief-photos', false, 20971520,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = 20971520,
      allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'];

DROP POLICY IF EXISTS upload_debrief_photo ON storage.objects;
CREATE POLICY upload_debrief_photo ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'debrief-photos');
DROP POLICY IF EXISTS read_debrief_photo ON storage.objects;
CREATE POLICY read_debrief_photo ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'debrief-photos');
DROP POLICY IF EXISTS delete_debrief_photo ON storage.objects;
CREATE POLICY delete_debrief_photo ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'debrief-photos');
