/**
 * TerrasseSupervisorPage — superviseur Terrasses VIP (1 personne) : voit les
 * sous-zones T2→T5 activées pour CE match et ouvre chacune.
 * Route : /zone/match/:sessionToken/terrasses
 * Source : RPC get_terrasse_zones_for_match (supabase/terrasse_zones.sql).
 */

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';

interface TerrasseZone {
  id: string;
  code: string;
  label: string;
  location: string | null;
  sort_order: number;
}

export default function TerrasseSupervisorPage() {
  const { token, session, loading } = useMatchSession();
  const [zones, setZones] = useState<TerrasseZone[]>([]);
  const [selected, setSelected] = useState<TerrasseZone | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token || !session?.success) return;
    void supabase.rpc('get_terrasse_zones_for_match', { p_token: token }).then(({ data }) => {
      const r = data as { success?: boolean; zones?: TerrasseZone[] } | null;
      setZones(r?.success ? r.zones ?? [] : []);
      setReady(true);
    });
  }, [token, session]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-pr-cream text-pr-black-soft/50">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-pr-black-soft/50">Session expirée.</div>;

  if (selected) {
    return (
      <div className="min-h-screen bg-pr-cream">
        <MatchZoneHeader session={session} back />
        <div className="mx-auto max-w-lg space-y-4 p-4">
          <button onClick={() => setSelected(null)} className="inline-flex items-center gap-2 text-sm text-pr-black-soft/50 hover:text-pr-black-soft/90">
            <ArrowLeft className="h-4 w-4" /> Retour aux terrasses
          </button>
          <div className="rounded-2xl bg-pr-black p-5 text-white">
            <p className="text-2xl font-black">🌿 Terrasse {selected.code}</p>
            <p className="mt-0.5 text-sm text-white/60">{selected.label}</p>
            {selected.location && <p className="mt-1 text-xs text-white/40">{selected.location}</p>}
          </div>
          <div className="rounded-2xl border border-pr-stone bg-white p-6 text-center text-sm text-pr-black-soft/50">
            Saisie des stocks par terrasse — intégration à venir.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pr-cream">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-4 p-4">
        <div className="rounded-2xl bg-pr-black p-5 text-white">
          <p className="mb-1 text-xs uppercase tracking-widest text-white/50">Superviseur</p>
          <p className="text-xl font-black">🌿 Terrasses VIP</p>
          <p className="mt-1 text-sm text-white/60">
            {zones.length} zone{zones.length > 1 ? 's' : ''} active{zones.length > 1 ? 's' : ''}
          </p>
        </div>

        {ready && zones.length === 0 ? (
          <div className="rounded-2xl bg-pr-stone/50 p-8 text-center text-sm text-pr-black-soft/50">
            Aucune terrasse activée pour ce match.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {zones.map((zone) => (
              <button
                key={zone.id}
                onClick={() => setSelected(zone)}
                className="rounded-2xl border border-pr-stone bg-white p-4 text-left transition-all hover:border-pr-stone hover:shadow-md"
              >
                <p className="text-2xl font-black text-pr-black">{zone.code}</p>
                <p className="mt-0.5 text-sm font-semibold text-pr-black-soft/70">{zone.label}</p>
                {zone.location && <p className="mt-1 text-xs text-pr-black-soft/45">{zone.location}</p>}
                <span className="mt-2 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">● Active</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
