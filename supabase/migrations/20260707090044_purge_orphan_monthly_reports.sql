-- ═══════════════════════════════════════════════════════════════════════════
-- purge_orphan_monthly_reports.sql — nettoyage des rapports mensuels orphelins.
--
-- Contexte : `monthly_staff_reports` est un SNAPSHOT (généré par
-- generate_monthly_staff_report) qui n'a PAS de FK vers events — le CASCADE
-- (037) ne peut donc pas le nettoyer, et le RPC de régénération ne purge pas
-- les lignes dont l'événement a été supprimé (upsert seul). Résultat : après
-- suppression d'un événement (ex. AIRBUS), ses lignes de rapport persistaient
-- (ex. HUGO PASCAL · Bistrot · 19h).
--
-- Ce correctif ajoute une fonction de purge + un trigger AFTER DELETE dédié
-- (additif : il coexiste avec trg_after_event_delete de 037, ne le remplace
-- pas). Le front applique déjà une défense-en-profondeur (masquage des
-- rapports orphelins) ; cette purge garde en plus le snapshot propre en base
-- pour les exports et autres consommateurs. Idempotent.
--
-- ⚠ NON appliqué automatiquement (PAT Supabase révoqué) — à exécuter via le
--   SQL Editor. Le nettoyage des lignes déjà orphelines a été fait via REST.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION purge_orphan_monthly_reports()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  -- Supprime les lignes dont AUCUN événement du détail n'existe encore,
  -- en ne touchant pas les lignes au détail vide (indéterminées).
  DELETE FROM monthly_staff_reports msr
  WHERE COALESCE(jsonb_array_length(to_jsonb(msr.events_detail)), 0) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(to_jsonb(msr.events_detail)) AS d
      JOIN events e ON e.event_name = d->>'event_name'
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_orphan_monthly_reports() TO authenticated;

-- Trigger dédié : purge le snapshot après chaque suppression d'événement.
CREATE OR REPLACE FUNCTION trg_purge_monthly_after_event_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM purge_orphan_monthly_reports();
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_purge_monthly_reports ON events;
CREATE TRIGGER trg_purge_monthly_reports
  AFTER DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION trg_purge_monthly_after_event_delete();

-- Nettoyage immédiat des orphelins déjà présents (idempotent).
SELECT purge_orphan_monthly_reports();
