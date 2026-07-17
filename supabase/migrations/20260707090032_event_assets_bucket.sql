-- ═══════════════════════════════════════════════════════════════════════════
-- event_assets_bucket.sql — Bucket privé pour le logo client (upload régisseur).
--   Le logo reste stocké dans seminar_report_draft.client_logo_url (URL signée) ;
--   le PDF le lit déjà là. On NE crée PAS events.client_logo_url (colonne morte).
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-assets', 'event-assets', false, 5242880,
        ARRAY['image/jpeg','image/png','image/webp','image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- Écriture réservée à ROLE_STADE (régisseur) ; lecture authenticated (signature).
DROP POLICY IF EXISTS event_assets_stade_insert ON storage.objects;
CREATE POLICY event_assets_stade_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-assets' AND is_stade());

DROP POLICY IF EXISTS event_assets_stade_update ON storage.objects;
CREATE POLICY event_assets_stade_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'event-assets' AND is_stade())
  WITH CHECK (bucket_id = 'event-assets' AND is_stade());

DROP POLICY IF EXISTS event_assets_read ON storage.objects;
CREATE POLICY event_assets_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'event-assets');
