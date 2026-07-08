/**
 * MatchZoneDebrief — compte-rendu terrain responsable (flux token).
 * Sections dépliables : effectif, stocks, clients, propreté, photos, suggestions.
 * Enregistre via save_zone_debrief (SECURITY DEFINER). Route : …/debrief
 */

import { useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';
import { PhotoGallery } from '@/components/debrief/PhotoGallery';

type YN = 'oui' | 'non' | 'partiel' | '';

const EMPTY = {
  nb_personnes: 0,
  effectif_adapte: '' as YN,
  efficacite: null as number | null,
  suggestion_effectif: '',
  stocks_suffisants: '' as YN,
  stocks_comment: '',
  suggestions_stocks: '',
  besoins_materiel: '',
  consignes_claires: '' as YN,
  problemes_coordination: '',
  retours_clients: null as number | null,
  retours_clients_detail: '',
  espace_etat_bon: '' as YN,
  problemes_dechets: '',
  suggestions_generales: '',
  besoins_specifiques: '',
};

function Section({ icon, title, children, open = false }: { icon: string; title: string; children: ReactNode; open?: boolean }) {
  const [o, setO] = useState(open);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setO(!o)} className="flex w-full items-center justify-between px-4 py-4">
        <span className="flex items-center gap-2 font-semibold text-slate-800">
          <span>{icon}</span>
          {title}
        </span>
        <span className="text-lg text-slate-400">{o ? '▲' : '▼'}</span>
      </button>
      {o && <div className="space-y-5 border-t border-slate-100 px-4 pb-5 pt-4">{children}</div>}
    </div>
  );
}

function YesNo({ value, onChange, partiel = true }: { value: YN; onChange: (v: YN) => void; partiel?: boolean }) {
  const opts: YN[] = partiel ? ['oui', 'partiel', 'non'] : ['oui', 'non'];
  return (
    <div className={`grid gap-2 ${partiel ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {opts.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-lg py-3 text-sm font-medium ${
            value === v
              ? v === 'oui'
                ? 'bg-green-500 text-white'
                : v === 'non'
                  ? 'bg-red-500 text-white'
                  : 'bg-amber-500 text-white'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {v === 'oui' ? '✅ Oui' : v === 'non' ? '❌ Non' : '⚠️ Partiel'}
        </button>
      ))}
    </div>
  );
}

function Score({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${value === n ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function Area({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400"
      />
    </div>
  );
}

export default function MatchZoneDebrief() {
  const { token, session, loading } = useMatchSession();
  const [nom, setNom] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-slate-500">Session expirée.</div>;

  async function submit() {
    setError('');
    if (nom.trim().length < 2) return setError('Indiquez votre nom (RG-001).');
    if (!form.nb_personnes) return setError('Renseignez le nombre de personnes présentes.');
    setSaving(true);
    const payload = {
      ...form,
      efficacite: form.efficacite != null ? String(form.efficacite) : null,
      retours_clients: form.retours_clients != null ? String(form.retours_clients) : null,
    };
    const { data, error: err } = await supabase.rpc('save_zone_debrief', { p_token: token, p_responsable: nom, p_payload: payload });
    setSaving(false);
    const r = data as { success?: boolean; error?: string } | null;
    if (err || !r?.success) return setError(r?.error ?? "Enregistrement indisponible (applique zone_rpcs.sql).");
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50">
        <MatchZoneHeader session={session} back />
        <div className="mx-auto max-w-lg p-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
            <p className="text-lg font-bold text-green-700">Débrief soumis ✅</p>
            <p className="mt-1 text-sm text-green-600">Merci {nom.toUpperCase()}. Votre retour a été transmis à l'équipe stade.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="mb-2 block text-sm font-medium text-slate-700">Votre nom *</label>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value.toUpperCase())}
            placeholder="NOM Prénom"
            className="min-h-[48px] w-full rounded-lg border border-slate-200 px-3 py-3 text-base focus:ring-2 focus:ring-amber-400"
          />
        </div>

        <Section icon="👥" title="Effectif & Organisation" open>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Nombre de personnes présentes *</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={form.nb_personnes || ''}
              onChange={(e) => set('nb_personnes', parseInt(e.target.value) || 0)}
              className="min-h-[48px] w-full rounded-lg border border-slate-200 px-3 py-3 text-base"
              placeholder="ex : 4"
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">L'effectif était-il adapté ?</p>
            <YesNo value={form.effectif_adapte} onChange={(v) => set('effectif_adapte', v)} />
          </div>
          <Score label="Efficacité de l'équipe (1 à 5)" value={form.efficacite} onChange={(v) => set('efficacite', v)} />
          <Area label="Suggestions sur l'effectif" placeholder="Postes à renforcer / surdimensionnés…" value={form.suggestion_effectif} onChange={(v) => set('suggestion_effectif', v)} />
        </Section>

        <Section icon="📦" title="Stocks & Matériel">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Les stocks étaient-ils suffisants ?</p>
            <YesNo value={form.stocks_suffisants} onChange={(v) => set('stocks_suffisants', v)} />
          </div>
          <Area label="Commentaire stocks" placeholder="Ruptures, surstock, produits manquants…" value={form.stocks_comment} onChange={(v) => set('stocks_comment', v)} />
          <Area label="Matériel / besoins" placeholder="Matériel manquant ou défaillant…" value={form.besoins_materiel} onChange={(v) => set('besoins_materiel', v)} />
          <Area label="Suggestions prochaines dotations" placeholder="Produits à ajouter, quantités à ajuster…" value={form.suggestions_stocks} onChange={(v) => set('suggestions_stocks', v)} />
        </Section>

        <Section icon="🗣" title="Clients & Communication">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Les consignes étaient-elles claires ?</p>
            <YesNo value={form.consignes_claires} onChange={(v) => set('consignes_claires', v)} />
          </div>
          <Score label="Satisfaction clients ressentie (1 à 5)" value={form.retours_clients} onChange={(v) => set('retours_clients', v)} />
          <Area label="Retours clients détaillés" placeholder="Compliments, réclamations…" value={form.retours_clients_detail} onChange={(v) => set('retours_clients_detail', v)} />
          <Area label="Problèmes de coordination" placeholder="Blocages, incidents…" value={form.problemes_coordination} onChange={(v) => set('problemes_coordination', v)} />
        </Section>

        <Section icon="🧹" title="Propreté & État de l'espace">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Espace rendu propre et en bon état ?</p>
            <YesNo value={form.espace_etat_bon} onChange={(v) => set('espace_etat_bon', v)} partiel={false} />
          </div>
          <Area label="Problèmes de propreté / déchets" placeholder="Points noirs, dépassements…" value={form.problemes_dechets} onChange={(v) => set('problemes_dechets', v)} />
        </Section>

        <Section icon="📸" title="Photos de l'événement">
          {nom.trim().length >= 2 ? (
            <>
              <PhotoGallery eventId={session.event_id} spaceId={session.space_id} photoType="mise_en_place" label="Mise en place (avant)" responsableNom={nom} />
              <hr className="border-slate-100" />
              <PhotoGallery eventId={session.event_id} spaceId={session.space_id} photoType="fb" label="F&B en service" responsableNom={nom} />
              <hr className="border-slate-100" />
              <PhotoGallery eventId={session.event_id} spaceId={session.space_id} photoType="fin_evenement" label="Fin d'événement" responsableNom={nom} />
            </>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Renseignez votre nom en haut pour ajouter des photos.</p>
          )}
        </Section>

        <Section icon="💡" title="Suggestions & Notes libres">
          <Area label="Suggestions générales" placeholder="Améliorations pour le prochain événement…" value={form.suggestions_generales} onChange={(v) => set('suggestions_generales', v)} />
          <Area label="Besoins spécifiques" placeholder="Matériel, personnel, configuration…" value={form.besoins_specifiques} onChange={(v) => set('besoins_specifiques', v)} />
        </Section>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        <button
          onClick={() => void submit()}
          disabled={saving || nom.trim().length < 2}
          className="mt-2 min-h-[56px] w-full rounded-xl bg-slate-900 py-4 text-base font-bold text-white disabled:opacity-40"
        >
          {saving ? 'Envoi…' : '✅ Soumettre le débrief'}
        </button>
      </div>
    </div>
  );
}
