/**
 * useSeminarReportDraft — brouillon de rapport séminaire (ROLE_STADE).
 * Charge le brouillon (auto-généré à la clôture), permet l'édition inline avec
 * sauvegarde automatique (debounce 2 s), et l'upload de photos.
 *
 * Résilient : si la table seminar_report_draft n'est pas encore provisionnée
 * (migration seminar_report.sql non appliquée), l'éditeur fonctionne sur un
 * brouillon construit côté client à partir de l'événement (aperçu + export
 * restent possibles) ; la persistance s'active dès que la table existe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Event } from '@/lib/types';

export interface ReportBullet {
  text: string;
  is_issue: boolean;
  is_positive: boolean;
}
export interface ReportPhoto {
  url: string;
  caption?: string;
  order: number;
}

export interface SeminarReportDraft {
  event_id: string;
  report_title: string | null;
  client_name: string | null;
  client_logo_url: string | null;
  report_date: string | null;
  cover_photo_url: string | null;
  responsable_commercial: string | null;
  pax: number | null;
  ca_ht: number | null;
  ca_type: string | null;
  ca_note: string | null;
  traiteur_company: string | null;
  setup_type: string | null;
  setup_note: string | null;
  total_fb_cost_ht: number | null;
  total_rh_cost: number | null;
  total_cost_ht: number | null;
  gain_net_ht: number | null;
  marge_pct: number | null;
  setup_photo_urls: ReportPhoto[];
  fb_photo_urls: ReportPhoto[];
  regisseur_name: string | null;
  regisseur_space: string | null;
  debrief_bullets: ReportBullet[];
  cleaning_score: number | null;
  technical_score: number | null;
  cleaning_issues: string[] | null;
  technical_issues: string[] | null;
  survey_respondent: string | null;
  survey_respondent_role: string | null;
  survey_submitted_at: string | null;
  cadre_score: string | null;
  proprete_score: string | null;
  traiteur_score: string | null;
  organisation_score: string | null;
  equipes_score: string | null;
  renouveler_score: string | null;
  nps_experience: number | null;
  nps_recommandation: number | null;
  survey_commentaire: string | null;
  draft_status: string;
  last_edited_at: string | null;
  exported_at: string | null;
}

/** Champs persistés (exclut les colonnes calculées côté base / lecture seule). */
const PERSISTED_KEYS: (keyof SeminarReportDraft)[] = [
  'report_title', 'client_name', 'client_logo_url', 'report_date', 'cover_photo_url',
  'responsable_commercial', 'pax', 'ca_ht', 'ca_type', 'ca_note', 'traiteur_company',
  'setup_type', 'setup_note', 'total_fb_cost_ht', 'total_rh_cost', 'total_cost_ht',
  'gain_net_ht', 'marge_pct', 'setup_photo_urls', 'fb_photo_urls', 'regisseur_name',
  'regisseur_space', 'debrief_bullets', 'cleaning_score', 'technical_score',
  'cleaning_issues', 'technical_issues', 'survey_respondent', 'survey_respondent_role',
  'survey_submitted_at', 'cadre_score', 'proprete_score', 'traiteur_score',
  'organisation_score', 'equipes_score', 'renouveler_score', 'nps_experience',
  'nps_recommandation', 'survey_commentaire', 'draft_status',
];

function defaultDraft(event: Event): SeminarReportDraft {
  const d = event.event_date ? new Date(event.event_date) : null;
  const dd = d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '';
  return {
    event_id: event.event_id,
    report_title: `RETOUR ${(event.event_name ?? '').toUpperCase()} ${dd}`.trim(),
    client_name: event.event_name ?? null,
    client_logo_url: null,
    report_date: event.event_date ?? null,
    cover_photo_url: null,
    responsable_commercial: null,
    pax: event.expected_attendees ?? null,
    ca_ht: 0,
    ca_type: 'payant',
    ca_note: null,
    traiteur_company: null,
    setup_type: null,
    setup_note: null,
    total_fb_cost_ht: null,
    total_rh_cost: null,
    total_cost_ht: null,
    gain_net_ht: null,
    marge_pct: null,
    setup_photo_urls: [],
    fb_photo_urls: [],
    regisseur_name: null,
    regisseur_space: null,
    debrief_bullets: [],
    cleaning_score: null,
    technical_score: null,
    cleaning_issues: null,
    technical_issues: null,
    survey_respondent: null,
    survey_respondent_role: null,
    survey_submitted_at: null,
    cadre_score: null,
    proprete_score: null,
    traiteur_score: null,
    organisation_score: null,
    equipes_score: null,
    renouveler_score: null,
    nps_experience: null,
    nps_recommandation: null,
    survey_commentaire: null,
    draft_status: 'brouillon',
    last_edited_at: null,
    exported_at: null,
  };
}

export function useSeminarReportDraft(event: Event) {
  const { user } = useAuth();
  const [draft, setDraft] = useState<SeminarReportDraft>(() => defaultDraft(event));
  const [loading, setLoading] = useState(true);
  const [provisioned, setProvisioned] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Chargement initial.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('seminar_report_draft')
        .select('*')
        .eq('event_id', event.event_id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Table absente (migration non appliquée) → mode client seul.
        setProvisioned(false);
      } else if (data) {
        setDraft({ ...defaultDraft(event), ...(data as Partial<SeminarReportDraft>) });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.event_id]);

  // Recalcul des coûts : F&B + RH + charges externes (traiteur, sécurité…).
  // get_event_costs intègre désormais external_cost_ht dans total_cost_ht.
  // `recomputeCosts` est réappelé après chaque modif de charge externe.
  const [externalCostHt, setExternalCostHt] = useState(0);
  const recomputeCosts = useCallback(async () => {
    let fb = 0;
    let rh = 0;
    let ext = 0;
    const { data: rpc, error } = await supabase.rpc('get_event_costs', { p_event_id: event.event_id });
    if (!error && rpc) {
      fb = Number((rpc as { fb_cost_ht: number }).fb_cost_ht) || 0;
      rh = Number((rpc as { rh_cost: number }).rh_cost) || 0;
      ext = Number((rpc as { external_cost_ht?: number }).external_cost_ht) || 0;
    } else {
      const { data: fbRow } = await supabase
        .from('event_cost_summary')
        .select('total_fb_cost_ht')
        .eq('event_id', event.event_id)
        .maybeSingle();
      fb = fbRow?.total_fb_cost_ht != null ? Number(fbRow.total_fb_cost_ht) : 0;
      const { data: sched } = await supabase
        .from('schedules')
        .select('computed_hours, hourly_rate')
        .eq('event_id', event.event_id);
      rh = ((sched ?? []) as { computed_hours: number | null; hourly_rate: number | null }[]).reduce(
        (s, r) => s + (r.hourly_rate != null && r.computed_hours != null ? Number(r.computed_hours) * Number(r.hourly_rate) : 0),
        0,
      );
      const { data: charges } = await supabase
        .from('event_external_charges')
        .select('amount_ht')
        .eq('event_id', event.event_id);
      ext = ((charges ?? []) as { amount_ht: number | null }[]).reduce((s, c) => s + (Number(c.amount_ht) || 0), 0);
    }
    setExternalCostHt(ext);
    setDraft((prev) => {
      const total = fb + rh + ext;
      const ca = Number(prev.ca_ht ?? 0);
      return {
        ...prev,
        total_fb_cost_ht: fb,
        total_rh_cost: rh,
        total_cost_ht: total,
        gain_net_ht: ca - total,
        marge_pct: ca > 0 ? ((ca - total) / ca) * 100 : null,
      };
    });
  }, [event.event_id]);

  const costsDone = useRef(false);
  useEffect(() => {
    if (loading || costsDone.current) return;
    costsDone.current = true;
    void recomputeCosts();
  }, [loading, recomputeCosts]);

  const persist = useCallback(
    async (current: SeminarReportDraft) => {
      if (!provisioned) return;
      setSaving(true);
      const payload: Record<string, unknown> = { event_id: current.event_id, last_edited_by: user?.name ?? 'Stade', last_edited_at: new Date().toISOString() };
      for (const k of PERSISTED_KEYS) payload[k] = current[k];
      const { error } = await supabase.from('seminar_report_draft').upsert(payload, { onConflict: 'event_id' });
      setSaving(false);
      if (!error) {
        dirty.current = false;
        setSavedAt(new Date().toISOString());
      } else if (/does not exist|schema cache/i.test(error.message)) {
        setProvisioned(false);
      }
    },
    [provisioned, user?.name],
  );

  /** Modifie le brouillon + planifie une sauvegarde auto (2 s). */
  const updateDraft = useCallback(
    (patch: Partial<SeminarReportDraft>) => {
      setDraft((prev) => {
        const next = { ...prev, ...patch };
        // Recalcule les totaux dépendants du CA.
        if ('ca_ht' in patch || 'total_cost_ht' in patch) {
          const total = Number(next.total_cost_ht ?? 0);
          const ca = Number(next.ca_ht ?? 0);
          next.gain_net_ht = ca - total;
          next.marge_pct = ca > 0 ? ((ca - total) / ca) * 100 : null;
        }
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void persist(next), 2000);
        return next;
      });
    },
    [persist],
  );

  /** Sauvegarde immédiate (ex: avant export). */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (dirty.current) await persist(draft);
  }, [draft, persist]);

  /** Upload d'une photo dans le bucket public zone-files ; renvoie l'URL. */
  const uploadPhoto = useCallback(async (file: File): Promise<string> => {
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `seminar-report/${event.event_id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('zone-files').upload(path, file, { upsert: false });
    if (error) throw error;
    return supabase.storage.from('zone-files').getPublicUrl(path).data.publicUrl;
  }, [event.event_id]);

  const setStatus = useCallback(
    async (status: string) => {
      updateDraft({ draft_status: status });
      if (provisioned) {
        await supabase
          .from('seminar_report_draft')
          .update({ draft_status: status, exported_at: status === 'exporté' ? new Date().toISOString() : null })
          .eq('event_id', event.event_id);
      }
    },
    [event.event_id, provisioned, updateDraft],
  );

  return { draft, updateDraft, flush, uploadPhoto, setStatus, loading, saving, savedAt, provisioned, externalCostHt, recomputeCosts };
}
