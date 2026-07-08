-- ═══════════════════════════════════════════════════════════════════════════
-- debrief_photo_checklist.sql — checklist de prises de vue du régisseur
-- (séminaire). Une ligne par événement. RLS ROLE_STADE (is_stade()).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS debrief_photo_checklist (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  regisseur_nom  TEXT NOT NULL,
  -- Mise en place
  mp_salle       BOOLEAN DEFAULT false,
  mp_tables      BOOLEAN DEFAULT false,
  mp_buffet      BOOLEAN DEFAULT false,
  mp_signage     BOOLEAN DEFAULT false,
  mp_tech        BOOLEAN DEFAULT false,
  -- F&B
  fb_buffet_open BOOLEAN DEFAULT false,
  fb_bar         BOOLEAN DEFAULT false,
  fb_plats       BOOLEAN DEFAULT false,
  fb_ambiance    BOOLEAN DEFAULT false,
  -- Fin d'événement
  fin_rangement  BOOLEAN DEFAULT false,
  fin_etat_salle BOOLEAN DEFAULT false,
  fin_incident   BOOLEAN DEFAULT false,
  notes_photo    TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id)
);

ALTER TABLE debrief_photo_checklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stade_all_checklist ON debrief_photo_checklist;
CREATE POLICY stade_all_checklist ON debrief_photo_checklist
  FOR ALL TO authenticated USING (is_stade()) WITH CHECK (is_stade());
