-- ═══════════════════════════════════════════════════════════════════
-- Correctif : liens de zone morts pour les événements datés dans le passé.
-- Cause : generate_space_token() fixait token_expires_at = event_date + 2j,
-- donc un événement passé (ou créé après coup) naissait avec un lien expiré.
-- Correctif : expiration = max(event_date + 2j, now() + 30j) → un lien est
-- toujours valide au moins 30 jours après sa création, quelle que soit la date.
-- Appliqué via MCP le 2026-07-03.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION generate_space_token()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_event_date date;
BEGIN
  IF NEW.access_token IS NULL THEN
    NEW.access_token := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
  END IF;
  IF NEW.token_expires_at IS NULL THEN
    SELECT event_date INTO v_event_date FROM events WHERE event_id = NEW.event_id;
    NEW.token_expires_at := GREATEST(
      COALESCE(v_event_date, current_date) + INTERVAL '2 days',
      now() + INTERVAL '30 days'
    );
  END IF;
  RETURN NEW;
END; $$;

-- Réanimation des tokens existants sur les événements non archivés :
UPDATE event_spaces es
SET token_expires_at = GREATEST(
  (SELECT event_date FROM events e WHERE e.event_id = es.event_id) + INTERVAL '2 days',
  now() + INTERVAL '30 days')
WHERE es.access_token IS NOT NULL
  AND EXISTS (SELECT 1 FROM events e WHERE e.event_id = es.event_id AND e.status <> 'archivé');

-- Côté front : SeminaireSpacesTab affiche l'expiration + « Lien expiré » + bouton
-- « Régénérer » (zoneApi.regenerateZoneToken) comme filet de sécurité admin.
