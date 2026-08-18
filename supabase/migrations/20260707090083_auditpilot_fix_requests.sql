-- ═══════════════════════════════════════════════════════════════════════════
-- auditpilot_fix_requests — file d'attente de « demandes de PR de correctif ».
--
-- Le front (ROLE_STADE) ne peut pas tenir de token GitHub. Quand l'humain valide
-- un correctif dans la modale AuditPilot, on ENREGISTRE une demande ici (RPC
-- request_audit_fix), et une CI GitHub (token en secret) ouvre la PR dédiée
-- `auditpilot/fix-<finding>`. Aucune écriture en production : on ne fait que
-- tracer l'intention + avancer le statut de l'anomalie (« correction proposée »).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_fix_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id   UUID NOT NULL REFERENCES public.audit_findings(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'pr_opened', 'failed', 'skipped')),
  pr_url       TEXT,
  pr_number    INT,
  branch       TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fixreq_status ON public.audit_fix_requests(status);
-- Une seule demande active (pending/pr_opened) par anomalie.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixreq_active
  ON public.audit_fix_requests(finding_id)
  WHERE status IN ('pending', 'pr_opened');

ALTER TABLE public.audit_fix_requests ENABLE ROW LEVEL SECURITY;

-- Lecture réservée à l'équipe stade (suivi de l'état des demandes).
DROP POLICY IF EXISTS fixreq_stade_select ON public.audit_fix_requests;
CREATE POLICY fixreq_stade_select ON public.audit_fix_requests
  FOR SELECT USING (public.is_stade());

-- Écriture uniquement via RPC SECURITY DEFINER (demande) ou service_role (CI).
REVOKE ALL ON public.audit_fix_requests FROM anon, authenticated;
GRANT SELECT ON public.audit_fix_requests TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- request_audit_fix — enregistre la demande + avance le statut de l'anomalie.
-- Idempotent : si une demande active existe déjà, on la renvoie sans doublon.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_audit_fix(p_finding UUID, p_by TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f        public.audit_findings%rowtype;
  existing public.audit_fix_requests%rowtype;
  new_id   UUID;
BEGIN
  IF NOT public.is_stade() THEN
    RETURN json_build_object('success', false, 'error', 'Réservé à l''équipe stade.');
  END IF;

  SELECT * INTO f FROM public.audit_findings WHERE id = p_finding;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Anomalie introuvable.');
  END IF;

  SELECT * INTO existing
    FROM public.audit_fix_requests
   WHERE finding_id = p_finding AND status IN ('pending', 'pr_opened')
   LIMIT 1;
  IF FOUND THEN
    RETURN json_build_object('success', true, 'already', true,
                             'request', existing.id, 'status', existing.status,
                             'pr_url', existing.pr_url);
  END IF;

  INSERT INTO public.audit_fix_requests(finding_id, requested_by)
  VALUES (p_finding, p_by)
  RETURNING id INTO new_id;

  -- Trace + avance le statut (jamais de modification des données de prod ici).
  PERFORM public.set_audit_finding_status(
    p_finding, 'correction proposée', p_by, 'PR de correctif demandée (AuditPilot).');

  RETURN json_build_object('success', true, 'request', new_id, 'status', 'pending');
END $$;

GRANT EXECUTE ON FUNCTION public.request_audit_fix(UUID, TEXT) TO authenticated;
