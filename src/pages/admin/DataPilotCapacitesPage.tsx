/**
 * DataPilotCapacitesPage (ROLE_STADE) — référentiel « Capacités & pax ».
 *
 * Donnée de référence du stade (master data) : capacité et pax de référence par
 * espace. Ces valeurs pilotent la normalisation conso /100 pax et le
 * dimensionnement des dotations. Lecture seule ici — l'édition d'un espace se
 * fait dans Configuration → Espaces (table `spaces`, écritures inchangées).
 * Route : /admin/datapilot/capacites.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Database, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface SpaceRow {
  space_id: string;
  space_name: string;
  display_name: string | null;
  space_type: string;
  service_type: string | null;
  capacity: number | null;
  max_pax: number | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export default function DataPilotCapacitesPage() {
  const [rows, setRows] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.from('spaces')
      .select('space_id, space_name, display_name, space_type, service_type, capacity, max_pax')
      .eq('active', true).order('space_type').order('space_name')
      .then(({ data }) => {
        setRows((data ?? []) as SpaceRow[]);
        setLoading(false);
      });
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, SpaceRow[]>();
    for (const r of rows) (m.get(r.space_type) ?? m.set(r.space_type, []).get(r.space_type)!).push(r);
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center gap-2">
        <div className="h-8 w-1.5 rounded-full bg-cyan-500" />
        <div>
          <h1 className="text-2xl font-black text-stone-900">Capacités & pax de référence</h1>
          <p className="text-sm text-stone-400">Master data espace — pilote la normalisation /100 pax et le dimensionnement des dotations.</p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs leading-relaxed text-cyan-900">
        <Database size={16} className="mt-0.5 shrink-0" />
        <p><b>D'où ça vient :</b> table <code>spaces</code> (Configuration → Espaces). <b>Ce que ça pilote :</b> le pax de référence sert de base à la conso normalisée /100 pax et au calcul des quantités recommandées. Lecture seule ici.</p>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-stone-100" />
      ) : (
        groups.map(([type, list]) => (
          <div key={type} className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
            <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-4 py-2 text-sm font-bold text-stone-700">
              <Building2 size={15} />{type}<span className="ml-1 text-xs font-normal text-stone-400">({list.length})</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-2">Espace</th>
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2 text-right">Capacité</th>
                  <th className="px-4 py-2 text-right">Pax de référence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {list.map((r) => (
                  <tr key={r.space_id} className="text-stone-800">
                    <td className="px-4 py-2 font-medium">{r.display_name || r.space_name}</td>
                    <td className="px-3 py-2 text-stone-500">{r.service_type || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.capacity) ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{num(r.max_pax) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      <Link to="/admin/spaces" className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-700 hover:text-cyan-900">
        <ExternalLink size={14} />Modifier les espaces (Configuration → Espaces)
      </Link>
    </div>
  );
}
