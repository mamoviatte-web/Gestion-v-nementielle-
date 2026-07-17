/**
 * MatchZoneRoadmap — feuille de route (lecture seule) : brief stade + dotations + équipe.
 * Route : /zone/match/:sessionToken/roadmap
 * Ne montre JAMAIS de page vide : si le brief n'est pas publié → bandeau ambre
 * « Brief en cours de préparation ». Dotations runner + horaires restent visibles.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';

interface Dotation {
  product_name: string;
  category: string;
  unit: string;
  planned_qty: number;
  runner_status: string;
}
interface BriefDotation {
  label?: string;
  product_name?: string;
  qty?: number | string;
  note?: string;
}
interface Sched {
  staff_name: string;
  role: string | null;
  planned_arrival: string | null;
  planned_departure: string | null;
}
interface Roadmap {
  success?: boolean;
  is_published?: boolean;
  brief_client?: string | null;
  brief_consigne?: string | null;
  brief_dress?: string | null;
  brief_horaires?: string | null;
  nb_pax_espace?: number | null;
  brief_dotations?: BriefDotation[] | null;
  info_contact?: string | null;
  info_acces?: string | null;
  info_materiel?: string | null;
  published_by?: string | null;
  published_at?: string | null;
  dotations?: Dotation[];
  schedules?: Sched[];
}

function BriefField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="border-b border-slate-50 px-4 py-3 last:border-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{value}</p>
    </div>
  );
}

export default function MatchZoneRoadmap() {
  const { token, session, loading } = useMatchSession();
  const [rm, setRm] = useState<Roadmap | null>(null);
  const [dotations, setDotations] = useState<Dotation[]>([]);
  const [schedules, setSchedules] = useState<Sched[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token || !session?.success) return;
    void supabase.rpc('get_zone_roadmap', { p_token: token }).then(({ data, error }) => {
      const r = data as Roadmap | null;
      if (error || !r?.success) return setReady(false);
      setRm(r);
      setDotations(r.dotations ?? []);
      setSchedules(r.schedules ?? []);
      setReady(true);
    });
  }, [token, session]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-slate-500">Session expirée.</div>;

  const byCat = dotations.reduce<Record<string, Dotation[]>>((acc, d) => {
    (acc[d.category] ??= []).push(d);
    return acc;
  }, {});

  const briefDotations = rm?.brief_dotations ?? [];
  const hasBrief = !!(
    rm?.is_published &&
    (rm.brief_client || rm.brief_consigne || rm.brief_dress || rm.brief_horaires ||
      rm.nb_pax_espace || rm.info_contact || rm.info_acces || rm.info_materiel || briefDotations.length)
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-5 p-4">
        {ready === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fonctionnalité en cours d'activation — applique <code>supabase/zone_roadmaps.sql</code>.
          </div>
        )}

        {/* ── Brief stade ─────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 font-bold text-slate-800">📋 Brief de l'espace</h2>
          {!hasBrief ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">⏳ Brief en cours de préparation</p>
              <p className="mt-1 text-xs text-amber-700">
                L'équipe stade finalise les consignes de votre espace. Les dotations et
                horaires ci-dessous restent valables.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {rm?.nb_pax_espace != null && (
                <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <span className="text-2xl">👥</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">Convives sur cet espace</p>
                    <p className="text-xl font-bold text-blue-900">{rm.nb_pax_espace}</p>
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <BriefField label="Client / réception" value={rm?.brief_client} />
                <BriefField label="Consignes de service" value={rm?.brief_consigne} />
                <BriefField label="Horaires" value={rm?.brief_horaires} />
                <BriefField label="Tenue / dress code" value={rm?.brief_dress} />
              </div>

              {briefDotations.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Dotations spécifiques
                  </div>
                  {briefDotations.map((d, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-slate-50 px-4 py-3 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{d.label ?? d.product_name ?? '—'}</p>
                        {d.note && <p className="text-xs text-slate-400">{d.note}</p>}
                      </div>
                      {d.qty != null && <p className="text-lg font-bold text-slate-900">{d.qty}</p>}
                    </div>
                  ))}
                </div>
              )}

              {(rm?.info_contact || rm?.info_acces || rm?.info_materiel) && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Infos pratiques
                  </div>
                  <BriefField label="Contact" value={rm?.info_contact} />
                  <BriefField label="Accès" value={rm?.info_acces} />
                  <BriefField label="Matériel" value={rm?.info_materiel} />
                </div>
              )}

              {rm?.published_by && (
                <p className="text-center text-xs text-slate-400">
                  Publié par {rm.published_by}
                  {rm.published_at ? ` · ${new Date(rm.published_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                </p>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-bold text-slate-800">📦 Dotations prévues ({dotations.length})</h2>
          {dotations.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
              Aucune dotation configurée pour cet espace.
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(byCat).map(([cat, lines]) => (
                <div key={cat} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {cat}
                  </div>
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-slate-50 px-4 py-3 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{l.product_name}</p>
                        <p className="text-xs text-slate-400">{l.unit}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-slate-900">{l.planned_qty}</p>
                        <p className="text-xs text-slate-400">{l.runner_status?.replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-bold text-slate-800">⏱ Équipe prévue</h2>
          {schedules.length === 0 ? (
            <div className="rounded-xl bg-slate-100 p-4 text-sm text-slate-500">Aucun horaire configuré.</div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {schedules.map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                    {s.staff_name.charAt(0).toUpperCase()}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">{s.staff_name}</p>
                    <p className="text-xs text-slate-400">{s.role}</p>
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    {s.planned_arrival?.slice(0, 5)} → {s.planned_departure?.slice(0, 5)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="pb-6 text-center text-xs text-slate-400">Configuré par l'équipe stade · Lecture seule</p>
      </div>
    </div>
  );
}
