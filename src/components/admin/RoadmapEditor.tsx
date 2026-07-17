/**
 * RoadmapEditor — brief digital par espace (table zone_roadmaps). L'équipe stade
 * remplit un brief que le responsable lit sur sa feuille de route.
 * Sélecteur d'espace → formulaire → Enregistrer brouillon / Publier.
 * Tant que non publié, le responsable voit « Brief en cours de préparation ».
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Send, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Alert, Badge, Button, Input, Textarea, Spinner } from '@/components/ui';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';

interface RoadmapRow {
  id: string;
  event_id: string;
  space_id: string;
  brief_client: string | null;
  brief_consigne: string | null;
  brief_dress: string | null;
  brief_horaires: string | null;
  nb_pax_espace: number | null;
  info_contact: string | null;
  info_acces: string | null;
  info_materiel: string | null;
  is_published: boolean;
  published_at: string | null;
  published_by: string | null;
}

type Draft = {
  brief_client: string;
  brief_consigne: string;
  brief_dress: string;
  brief_horaires: string;
  nb_pax_espace: string;
  info_contact: string;
  info_acces: string;
  info_materiel: string;
};

const EMPTY: Draft = {
  brief_client: '', brief_consigne: '', brief_dress: '', brief_horaires: '',
  nb_pax_espace: '', info_contact: '', info_acces: '', info_materiel: '',
};

function toDraft(r: RoadmapRow | null): Draft {
  if (!r) return { ...EMPTY };
  return {
    brief_client: r.brief_client ?? '',
    brief_consigne: r.brief_consigne ?? '',
    brief_dress: r.brief_dress ?? '',
    brief_horaires: r.brief_horaires ?? '',
    nb_pax_espace: r.nb_pax_espace != null ? String(r.nb_pax_espace) : '',
    info_contact: r.info_contact ?? '',
    info_acces: r.info_acces ?? '',
    info_materiel: r.info_materiel ?? '',
  };
}

export function RoadmapEditor({
  eventId,
  spaces,
}: {
  eventId: string;
  spaces: EventSpaceWithSpace[];
}) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [spaceId, setSpaceId] = useState<string>(spaces[0]?.space_id ?? '');
  const [row, setRow] = useState<RoadmapRow | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishedMap, setPublishedMap] = useState<Record<string, boolean>>({});

  // Statut publié de chaque espace (pour badges du sélecteur).
  useEffect(() => {
    let active = true;
    void supabase
      .from('zone_roadmaps')
      .select('space_id, is_published')
      .eq('event_id', eventId)
      .then(({ data }) => {
        if (!active) return;
        const map: Record<string, boolean> = {};
        (data ?? []).forEach((r: { space_id: string; is_published: boolean }) => { map[r.space_id] = r.is_published; });
        setPublishedMap(map);
      });
    return () => { active = false; };
  }, [eventId, saving]);

  useEffect(() => {
    if (!spaceId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    void supabase
      .from('zone_roadmaps')
      .select('*')
      .eq('event_id', eventId)
      .eq('space_id', spaceId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const r = (data as RoadmapRow | null) ?? null;
        setRow(r);
        setDraft(toDraft(r));
        setLoading(false);
      });
    return () => { active = false; };
  }, [eventId, spaceId]);

  async function persist(publish: boolean) {
    if (!spaceId) return;
    setSaving(true);
    const paxNum = draft.nb_pax_espace.trim() === '' ? null : Number(draft.nb_pax_espace);
    const payload: Record<string, unknown> = {
      event_id: eventId,
      space_id: spaceId,
      brief_client: draft.brief_client.trim() || null,
      brief_consigne: draft.brief_consigne.trim() || null,
      brief_dress: draft.brief_dress.trim() || null,
      brief_horaires: draft.brief_horaires.trim() || null,
      nb_pax_espace: paxNum != null && !Number.isNaN(paxNum) ? paxNum : null,
      info_contact: draft.info_contact.trim() || null,
      info_acces: draft.info_acces.trim() || null,
      info_materiel: draft.info_materiel.trim() || null,
    };
    if (publish) {
      payload.is_published = true;
      payload.published_at = new Date().toISOString();
      payload.published_by = user?.email ?? 'Équipe stade';
    } else if (row?.is_published) {
      // On garde publié tant qu'on ne dépublie pas explicitement.
      payload.is_published = true;
    }

    const { data, error } = await supabase
      .from('zone_roadmaps')
      .upsert(payload, { onConflict: 'event_id,space_id' })
      .select('*')
      .maybeSingle();

    setSaving(false);
    if (error) {
      showToast(`Échec : ${error.message}`, 'warning');
      return;
    }
    setRow((data as RoadmapRow | null) ?? null);
    showToast(publish ? 'Brief publié ✅' : 'Brouillon enregistré', 'success');
  }

  async function unpublish() {
    if (!spaceId) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('zone_roadmaps')
      .update({ is_published: false })
      .eq('event_id', eventId)
      .eq('space_id', spaceId)
      .select('*')
      .maybeSingle();
    setSaving(false);
    if (error) return showToast(`Échec : ${error.message}`, 'warning');
    setRow((data as RoadmapRow | null) ?? null);
    showToast('Brief dépublié — repassé en brouillon', 'info');
  }

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <Alert variant="info">
        Rédigez le brief de chaque espace. Le responsable le voit sur sa feuille de
        route <strong>uniquement après publication</strong> — sinon il lit « Brief en cours
        de préparation ».
      </Alert>

      {/* Sélecteur d'espace avec badge publié */}
      <div className="flex flex-wrap gap-2">
        {spaces.map((s) => {
          const pub = publishedMap[s.space_id];
          const activeSel = s.space_id === spaceId;
          return (
            <button
              key={s.space_id}
              onClick={() => setSpaceId(s.space_id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                activeSel ? 'border-pr-black bg-pr-black text-white' : 'border-pr-stone bg-white text-pr-black hover:border-pr-black'
              }`}
            >
              {s.spaces?.space_name ?? s.space_id}
              {pub && <CheckCircle2 className={`h-3.5 w-3.5 ${activeSel ? 'text-emerald-300' : 'text-emerald-600'}`} />}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Spinner label="Chargement du brief…" />
      ) : !spaceId ? (
        <Alert variant="warning">Aucun espace activé pour cet événement.</Alert>
      ) : (
        <div className="space-y-4 rounded-xl border border-pr-stone bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-pr-black">
              {spaces.find((s) => s.space_id === spaceId)?.spaces?.space_name ?? 'Espace'}
            </span>
            {row?.is_published ? (
              <Badge tone="success"><CheckCircle2 className="mr-1 inline h-3 w-3" /> Publié</Badge>
            ) : (
              <Badge tone="neutral">Brouillon</Badge>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pr-black">Client / réception</span>
              <Input value={draft.brief_client} onChange={set('brief_client')} placeholder="Nom du client, type de réception…" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pr-black">Convives sur cet espace</span>
              <Input type="number" min={0} value={draft.nb_pax_espace} onChange={set('nb_pax_espace')} placeholder="ex. 40" />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-pr-black">Consignes de service</span>
            <Textarea rows={3} value={draft.brief_consigne} onChange={set('brief_consigne')} placeholder="Déroulé du service, points d'attention…" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pr-black">Horaires</span>
              <Textarea rows={2} value={draft.brief_horaires} onChange={set('brief_horaires')} placeholder="Arrivée équipe, ouverture, service…" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pr-black">Tenue / dress code</span>
              <Textarea rows={2} value={draft.brief_dress} onChange={set('brief_dress')} placeholder="Tenue attendue…" />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pr-black">Contact</span>
              <Input value={draft.info_contact} onChange={set('info_contact')} placeholder="Référent, téléphone…" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pr-black">Accès</span>
              <Input value={draft.info_acces} onChange={set('info_acces')} placeholder="Entrée, badge…" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pr-black">Matériel</span>
              <Input value={draft.info_materiel} onChange={set('info_materiel')} placeholder="Matériel spécifique…" />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-pr-stone pt-4">
            <Button variant="secondary" onClick={() => void persist(false)} disabled={saving}>
              <Save className="mr-1.5 h-4 w-4" /> Enregistrer le brouillon
            </Button>
            <Button onClick={() => void persist(true)} disabled={saving}>
              <Send className="mr-1.5 h-4 w-4" /> {row?.is_published ? 'Republier' : 'Publier le brief'}
            </Button>
            {row?.is_published && (
              <button
                onClick={() => void unpublish()}
                disabled={saving}
                className="ml-auto text-sm font-medium text-pr-rust hover:underline disabled:opacity-50"
              >
                Dépublier
              </button>
            )}
          </div>

          {row?.is_published && row.published_by && (
            <p className="text-xs text-pr-black/50">
              Publié par {row.published_by}
              {row.published_at ? ` · ${new Date(row.published_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
