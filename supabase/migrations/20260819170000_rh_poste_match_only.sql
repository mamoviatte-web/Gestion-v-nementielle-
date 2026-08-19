-- ═══════════════════════════════════════════════════════════════════════════
-- RH · Poste de travail — verrouillage MATCHS UNIQUEMENT (défense en profondeur).
--
-- Le pipeline RH par émargement ne concerne que les matchs. Même si le front est
-- contourné (deep link, appel direct), un séminaire ne peut jamais entrer :
--   • staff_update / rh_validate_baseline / rh_validate_final : garde is_match_event
--   • event_service_providers : trigger BEFORE INSERT/UPDATE qui refuse les non-matchs
-- S'appuie sur public.is_match_event(uuid) (déjà en base).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- staff_update — + garde matchs (l'event est déduit de la ligne RH).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_update(p_id UUID, p_changes JSONB, p_by TEXT, p_role TEXT DEFAULT 'stade')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.event_staff_preplan%rowtype;
  is_resp BOOLEAN := (NOT public.is_stade()) OR lower(coalesce(p_role, '')) IN ('responsable', 'resp', 'zone');
  touches_planning BOOLEAN;
  n_actual_end   TIME := nullif(p_changes->>'actual_end', '')::time;
  n_actual_start TIME := nullif(p_changes->>'actual_start', '')::time;
  n_planned_start TIME := nullif(p_changes->>'planned_start', '')::time;
  n_planned_end  TIME := nullif(p_changes->>'planned_end', '')::time;
  n_rate    NUMERIC := nullif(p_changes->>'hourly_rate', '')::numeric;
  n_forfait NUMERIC := nullif(p_changes->>'forfait_amount', '')::numeric;
BEGIN
  SELECT * INTO r FROM public.event_staff_preplan WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Ligne RH introuvable.'); END IF;

  IF NOT public.is_match_event(r.event_id) THEN
    RETURN json_build_object('success', false, 'error', 'Action réservée aux matchs (pas de séminaire).');
  END IF;

  touches_planning := (p_changes ? 'planned_start') OR (p_changes ? 'actual_start') OR (p_changes ? 'planned_end')
    OR (p_changes ? 'planned_hours') OR (p_changes ? 'hourly_rate') OR (p_changes ? 'billing_mode')
    OR (p_changes ? 'forfait_amount') OR (p_changes ? 'staff_status') OR (p_changes ? 'agent_nom')
    OR (p_changes ? 'agent_prenom') OR (p_changes ? 'agent_role') OR (p_changes ? 'space_id') OR (p_changes ? 'pole');

  IF is_resp AND touches_planning THEN
    RETURN json_build_object('success', false,
      'error', 'Les heures de début et le planning ne sont pas modifiables par un responsable. Vous pouvez seulement ajuster le départ réel ou signaler une absence.');
  END IF;

  UPDATE public.event_staff_preplan SET
    actual_end     = coalesce(n_actual_end, actual_end),
    status         = coalesce(p_changes->>'status', status),
    note           = coalesce(p_changes->>'note', note),
    actual_start   = CASE WHEN is_resp THEN actual_start ELSE coalesce(n_actual_start, actual_start) END,
    planned_start  = CASE WHEN is_resp THEN planned_start ELSE coalesce(n_planned_start, planned_start) END,
    planned_end    = CASE WHEN is_resp THEN planned_end ELSE coalesce(n_planned_end, planned_end) END,
    hourly_rate    = CASE WHEN is_resp THEN hourly_rate ELSE coalesce(n_rate, hourly_rate) END,
    billing_mode   = CASE WHEN is_resp THEN billing_mode ELSE coalesce(p_changes->>'billing_mode', billing_mode) END,
    forfait_amount = CASE WHEN is_resp THEN forfait_amount ELSE coalesce(n_forfait, forfait_amount) END,
    staff_status   = CASE WHEN is_resp THEN staff_status ELSE coalesce(p_changes->>'staff_status', staff_status) END,
    updated_by     = p_by
  WHERE id = p_id;

  RETURN json_build_object('success', true, 'id', p_id);
END $$;
GRANT EXECUTE ON FUNCTION public.staff_update(UUID, JSONB, TEXT, TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- rh_validate_baseline — + garde matchs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_validate_baseline(p_event UUID, p_by TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  IF NOT public.is_stade() THEN RETURN json_build_object('success', false, 'error', 'Réservé à la coordinatrice RH.'); END IF;
  IF NOT public.is_match_event(p_event) THEN RETURN json_build_object('success', false, 'error', 'Action réservée aux matchs (pas de séminaire).'); END IF;

  UPDATE public.event_staff_preplan p SET baseline_json = jsonb_build_object(
    'agent_nom', p.agent_nom, 'agent_prenom', p.agent_prenom, 'agent_role', p.agent_role,
    'space_id', p.space_id, 'pole', p.pole, 'planned_start', p.planned_start, 'planned_end', p.planned_end,
    'planned_hours', p.planned_hours, 'hourly_rate', p.hourly_rate, 'billing_mode', p.billing_mode,
    'forfait_amount', p.forfait_amount, 'staff_status', p.staff_status, 'status', p.status)
  WHERE p.event_id = p_event;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.events SET rh_state = 'valide_j1', rh_baseline_at = now() WHERE event_id = p_event;
  RETURN json_build_object('success', true, 'lignes', v_n, 'rh_state', 'valide_j1');
END $$;
GRANT EXECUTE ON FUNCTION public.rh_validate_baseline(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- rh_validate_final — + garde matchs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_validate_final(p_event UUID, p_by TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_stade() THEN RETURN json_build_object('success', false, 'error', 'Réservé à la coordinatrice RH.'); END IF;
  IF NOT public.is_match_event(p_event) THEN RETURN json_build_object('success', false, 'error', 'Action réservée aux matchs (pas de séminaire).'); END IF;
  UPDATE public.events SET rh_state = 'live', rh_final_at = now() WHERE event_id = p_event;
  RETURN json_build_object('success', true, 'rh_state', 'live');
END $$;
GRANT EXECUTE ON FUNCTION public.rh_validate_final(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- event_service_providers — trigger : refuser tout rattachement à un non-match.
-- (l'insertion se fait en direct via RLS, pas par RPC → on garde au niveau table)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esp_match_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_match_event(NEW.event_id) THEN
    RAISE EXCEPTION 'Prestataires RH réservés aux matchs (pas de séminaire).';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS esp_match_guard_trg ON public.event_service_providers;
CREATE TRIGGER esp_match_guard_trg
  BEFORE INSERT OR UPDATE ON public.event_service_providers
  FOR EACH ROW EXECUTE FUNCTION public.esp_match_guard();
