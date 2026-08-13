/**
 * BuvetteDebriefForm — débrief d'UNE buvette membre (flux token superviseur).
 * Mêmes sections que le débrief zone standard, mais écrit sur le space de la
 * buvette ciblée (p_target_space) via save_zone_buvette_debrief. Préremplissage
 * via get_zone_buvette_debrief. Réservé au superviseur Buvette 1/2 (garde base
 * _buvette_member). Le nom du responsable est fourni par la page (RG-001).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

type YN = 'oui' | 'non' | 'partiel' | '';

interface DebriefForm {
  nb_personnes: number;
  effectif_adapte: YN;
  efficacite: number | null;
  suggestion_effectif: string;
  stocks_suffisants: YN;
  stocks_comment: string;
  suggestions_stocks: string;
  besoins_materiel: string;
  consignes_claires: YN;
  problemes_coordination: string;
  retours_clients: number | null;
  retours_clients_detail: string;
  espace_etat_bon: YN;
  problemes_dechets: string;
  suggestions_generales: string;
  besoins_specifiques: string;
}

const EMPTY: DebriefForm = {
  nb_personnes: 0, effectif_adapte: '', efficacite: null, suggestion_effectif: '',
  stocks_suffisants: '', stocks_comment: '', suggestions_stocks: '', besoins_materiel: '',
  consignes_claires: '', problemes_coordination: '', retours_clients: null, retours_clients_detail: '',
  espace_etat_bon: '', problemes_dechets: '', suggestions_generales: '', besoins_specifiques: '',
};

const asYN = (v: unknown): YN => (v === 'oui' || v === 'non' || v === 'partiel' ? v : '');
const asNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function Section({ icon, title, children, open = false }: { icon: string; title: string; children: ReactNode; open?: boolean }) {
  const [o, setO] = useState(open);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setO(!o)} className="flex w-full items-center justify-between px-4 py-4">
        <span className="flex items-center gap-2 font-semibold text-slate-800"><span>{icon}</span>{title}</span>
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
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`rounded-lg py-3 text-sm font-medium ${
            value === v ? (v === 'oui' ? 'bg-green-500 text-white' : v === 'non' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white') : 'bg-slate-100 text-slate-600'
          }`}>
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
          <button key={n} type="button" onClick={() => onChange(n)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${value === n ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
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
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400" />
    </div>
  );
}

export function BuvetteDebriefForm({
  token,
  spaceId,
  responsable,
  code,
  onSubmitted,
}: {
  token: string;
  spaceId: string;
  responsable: string;
  code?: string;
  onSubmitted?: () => void;
}) {
  const [form, setForm] = useState<DebriefForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof DebriefForm>(k: K, v: DebriefForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Préremplissage du débrief existant de cette buvette.
  useEffect(() => {
    let alive = true;
    setSubmitted(false);
    void supabase.rpc('get_zone_buvette_debrief', { p_token: token, p_target_space: spaceId }).then(({ data }) => {
      if (!alive) return;
      const d = (data as { success?: boolean; debrief?: Record<string, unknown> | null } | null)?.debrief;
      if (!d) { setForm(EMPTY); return; }
      setForm({
        nb_personnes: asNum(d.nb_personnes) ?? 0,
        effectif_adapte: asYN(d.effectif_adapte),
        efficacite: asNum(d.efficacite),
        suggestion_effectif: String(d.suggestion_effectif ?? ''),
        stocks_suffisants: asYN(d.stocks_suffisants),
        stocks_comment: String(d.stocks_comment ?? ''),
        suggestions_stocks: String(d.suggestions_stocks ?? ''),
        besoins_materiel: String(d.besoins_materiel ?? ''),
        consignes_claires: asYN(d.consignes_claires),
        problemes_coordination: String(d.problemes_coordination ?? ''),
        retours_clients: asNum(d.retours_clients),
        retours_clients_detail: String(d.retours_clients_detail ?? ''),
        espace_etat_bon: asYN(d.espace_etat_bon),
        problemes_dechets: String(d.problemes_dechets ?? ''),
        suggestions_generales: String(d.suggestions_generales ?? ''),
        besoins_specifiques: String(d.besoins_specifiques ?? ''),
      });
    });
    return () => { alive = false; };
  }, [token, spaceId]);

  async function submit() {
    setError('');
    if (responsable.trim().length < 2) return setError('Indiquez votre nom en haut (RG-001).');
    if (!form.nb_personnes) return setError('Renseignez le nombre de personnes présentes.');
    setSaving(true);
    const payload = {
      ...form,
      efficacite: form.efficacite != null ? String(form.efficacite) : null,
      retours_clients: form.retours_clients != null ? String(form.retours_clients) : null,
    };
    const { data, error: err } = await supabase.rpc('save_zone_buvette_debrief', {
      p_token: token, p_responsable: responsable, p_payload: payload, p_target_space: spaceId,
    });
    setSaving(false);
    const r = data as { success?: boolean; error?: string } | null;
    if (err || !r?.success) return setError(r?.error ?? 'Enregistrement indisponible.');
    setSubmitted(true);
    onSubmitted?.();
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-lg font-bold text-green-700">Débrief {code ? `${code} ` : ''}enregistré ✅</p>
        <p className="mt-1 text-sm text-green-600">Merci. Vous pouvez modifier une autre buvette ou revenir au tableau de bord.</p>
        <button onClick={() => setSubmitted(false)} className="mt-3 rounded-lg border border-green-300 px-3 py-1.5 text-sm text-green-700">
          Rouvrir le débrief
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Section icon="👥" title="Effectif & Organisation" open>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Nombre de personnes présentes *</label>
          <input type="number" min={0} inputMode="numeric" value={form.nb_personnes || ''}
            onChange={(e) => set('nb_personnes', parseInt(e.target.value) || 0)}
            className="min-h-[48px] w-full rounded-lg border border-slate-200 px-3 py-3 text-base" placeholder="ex : 3" />
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

      <Section icon="💡" title="Suggestions & Notes libres">
        <Area label="Suggestions générales" placeholder="Améliorations pour le prochain événement…" value={form.suggestions_generales} onChange={(v) => set('suggestions_generales', v)} />
        <Area label="Besoins spécifiques" placeholder="Matériel, personnel, configuration…" value={form.besoins_specifiques} onChange={(v) => set('besoins_specifiques', v)} />
      </Section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      <button onClick={() => void submit()} disabled={saving || responsable.trim().length < 2}
        className="min-h-[56px] w-full rounded-xl bg-slate-900 py-4 text-base font-bold text-white disabled:opacity-40">
        {saving ? 'Envoi…' : `✅ Soumettre le débrief${code ? ` — ${code}` : ''}`}
      </button>
    </div>
  );
}
