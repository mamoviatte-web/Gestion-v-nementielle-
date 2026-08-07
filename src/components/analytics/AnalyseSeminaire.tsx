/**
 * AnalyseSeminaire — onglet « Séminaire » de la page Analyses (ROLE_STADE).
 *
 * Modèle dédié séminaire (≠ match) : économie par participant + mix haut de
 * gamme, sur les espaces salon/loge/bar uniquement (jamais de buvettes).
 * Source : RPC get_seminaire_analysis (RG-003 : réservée à ROLE_STADE).
 */

import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Presentation } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const CAT_COLORS: Record<string, string> = {
  Champagne: '#C9A646',
  Vins: '#7C3AED',
  Spiritueux: '#EA580C',
  Soft: '#2563EB',
  Bières: '#D97706',
  Sirops: '#DB2777',
  Matériel: '#6B7280',
  Autre: '#9CA3AF',
};

const PROFILE_LABELS: Record<string, string> = {
  salon: 'Salon',
  loge: 'Loge',
  wine_bar: 'Wine bar',
  club: 'Club',
  bar_pub: 'Bar / Pub',
};

/** Coercition sûre (PostgREST peut sérialiser numeric en chaîne). */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface SemKpis {
  nb_seminaires: number;
  participants: number;
  unites: number;
  cout_ht: number;
  cout_par_participant: number;
}
interface SemEspace {
  space_name: string;
  profile: string;
  nb_seminaires: number;
  unites: number;
  cout_ht: number;
  cout_par_participant: number;
  produit_phare: string | null;
}
interface SemCat {
  categorie: string;
  unites: number;
  cout: number;
}
interface SemEvent {
  event_name: string;
  participants: number;
  cout_ht: number;
  cout_par_participant: number;
  facture_par_participant: number | null;
  marge_par_participant: number | null;
}
interface SemAnalysis {
  kpis: SemKpis;
  espaces: SemEspace[];
  categories: SemCat[];
  par_seminaire: SemEvent[];
}

const euro = (v: number): string => `${v.toFixed(2)} € HT`;

export function AnalyseSeminaire() {
  const [data, setData] = useState<SemAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: res } = await supabase.rpc('get_seminaire_analysis', { p_scope: 'all' });
      if (!active) return;
      const r = res as Partial<SemAnalysis> | null;
      setData({
        kpis: {
          nb_seminaires: num(r?.kpis?.nb_seminaires),
          participants: num(r?.kpis?.participants),
          unites: num(r?.kpis?.unites),
          cout_ht: num(r?.kpis?.cout_ht),
          cout_par_participant: num(r?.kpis?.cout_par_participant),
        },
        espaces: (r?.espaces ?? []) as SemEspace[],
        categories: (r?.categories ?? []) as SemCat[],
        par_seminaire: (r?.par_seminaire ?? []) as SemEvent[],
      });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 rounded-2xl bg-stone-100" />
        ))}
      </div>
    );
  }

  if (!data || data.kpis.nb_seminaires === 0) {
    return (
      <div className="rounded-2xl border border-stone-100 bg-white p-12 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-stone-50">
          <Presentation className="h-8 w-8 text-stone-300" />
        </div>
        <h3 className="text-lg font-bold text-stone-800">Aucun séminaire clôturé pour l'instant</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-400">
          Les analyses s'afficheront après la clôture d'un premier séminaire (salon / loge / bar).
        </p>
      </div>
    );
  }

  const { kpis, espaces, categories, par_seminaire } = data;
  const panierMoyen = kpis.participants > 0 ? kpis.unites / kpis.participants : 0;
  const donut = categories.map((c) => ({ name: c.categorie, value: num(c.unites) }));
  const totalDonut = donut.reduce((s, d) => s + d.value, 0);
  const maxCpp = Math.max(...par_seminaire.map((e) => num(e.cout_par_participant)), 1);
  const maxEspaceCpp = Math.max(...espaces.map((e) => num(e.cout_par_participant)), 1);

  const KPIS = [
    { label: 'Séminaires', value: String(kpis.nb_seminaires), sub: 'avec consommation', accent: '#1A1A2E', icon: '📋' },
    { label: 'Participants', value: kpis.participants.toLocaleString('fr-FR'), sub: 'cumulés', accent: '#059669', icon: '👥' },
    { label: 'Coût F&B / participant', value: `${kpis.cout_par_participant.toFixed(2)} €`, sub: 'indicateur clé', accent: '#C9A646', icon: '💶' },
    { label: 'Panier moyen', value: `${panierMoyen.toFixed(1)}`, sub: 'unités / participant', accent: '#7C3AED', icon: '🛒' },
  ];

  return (
    <div className="space-y-6">
      {/* KPIs séminaire */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k.label} className="relative overflow-hidden rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
            <div className="absolute left-0 right-0 top-0 h-1 rounded-t-2xl" style={{ background: k.accent }} />
            <div className="mb-3 flex items-start justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{k.label}</p>
              <span className="text-xl">{k.icon}</span>
            </div>
            <p className="text-3xl font-black text-stone-900">{k.value}</p>
            <p className="mt-1 text-xs text-stone-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Espaces séminaire + Donut catégories */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 font-bold text-stone-800">🥂 Espaces séminaire utilisés</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {espaces.map((e) => {
              const cpp = num(e.cout_par_participant);
              const intensity = cpp / maxEspaceCpp;
              return (
                <div key={e.space_name} className="rounded-2xl border border-stone-100 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-black text-stone-900">{e.space_name}</p>
                    <span className="rounded-lg bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">
                      {PROFILE_LABELS[e.profile] ?? e.profile}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-black" style={{ color: '#C9A646' }}>
                      {cpp.toFixed(2)} €
                    </span>
                    <span className="text-xs text-stone-400">/ participant</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
                    <div className="h-full rounded-full" style={{ width: `${intensity * 100}%`, background: '#C9A646' }} />
                  </div>
                  <p className="mt-2 text-xs text-stone-500">
                    {num(e.nb_seminaires)} séminaire{num(e.nb_seminaires) > 1 ? 's' : ''} · {num(e.unites)} unités ·{' '}
                    {euro(num(e.cout_ht))}
                  </p>
                  {e.produit_phare && (
                    <p className="mt-1 truncate text-xs text-stone-400">🏆 {e.produit_phare}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-bold text-stone-800">Répartition par catégorie</h3>
          {donut.length > 0 ? (
            <>
              <div className="relative">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={donut} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                      {donut.map((entry, i) => (
                        <Cell key={i} fill={CAT_COLORS[entry.name] ?? '#9CA3AF'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${Number(value)} unités`, '']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-2xl font-black text-stone-900">{Math.round(totalDonut)}</p>
                  <p className="text-xs text-stone-400">unités</p>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                {categories.map((c) => (
                  <div key={c.categorie} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLORS[c.categorie] ?? '#9CA3AF' }} />
                      <span className="text-stone-600">{c.categorie}</span>
                    </div>
                    <span className="font-semibold text-stone-800">{euro(num(c.cout))}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-stone-400">Aucune consommation.</p>
          )}
        </div>
      </div>

      {/* Comparatif par séminaire : coût / participant (+ marge si facturé) */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-lg font-bold text-stone-900">📊 Coût par participant, par séminaire</h3>
        <p className="mb-4 text-xs text-stone-400">Repérer les séminaires trop coûteux · marge F&B si facturation renseignée</p>
        <div className="space-y-3">
          {par_seminaire.map((e) => {
            const cpp = num(e.cout_par_participant);
            const pct = Math.round((cpp / maxCpp) * 100);
            const marge = e.marge_par_participant;
            return (
              <div key={e.event_name} className="rounded-xl px-1 py-2">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-stone-800">{e.event_name}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-black text-stone-900">{cpp.toFixed(2)} €/part.</span>
                    <span className="text-xs text-stone-400">{num(e.participants)} pers.</span>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#C9A646' }} />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-stone-400">Consommé {euro(num(e.cout_ht))}</span>
                  {e.facture_par_participant != null ? (
                    <>
                      <span className="text-stone-400">· Facturé {num(e.facture_par_participant).toFixed(2)} €/part.</span>
                      {marge != null && (
                        <span
                          className={`rounded px-1.5 py-0.5 font-semibold ${marge >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
                        >
                          Marge {marge.toFixed(2)} €/part.
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="rounded bg-stone-50 px-1.5 py-0.5 text-stone-400">Facturation non renseignée</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
