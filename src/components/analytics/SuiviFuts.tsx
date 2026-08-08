/**
 * SuiviFuts — bloc « Suivi des fûts » (onglet Match/Tout des Analyses).
 * Nombre de fûts consommés par type et par match + total + coût, scopé à la
 * sélection d'événement (get_fut_analysis(scope)). RG-003 : réservé ROLE_STADE.
 * Masqué s'il n'y a aucun fût (ex. scope séminaire).
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { supabase } from '@/lib/supabase';

interface FutType {
  product_name: string;
  total_futs: number;
  cout_ht: number;
  par_match: { event_name: string; futs: number }[];
}
interface FutMatch {
  event_name: string;
  event_date: string;
  total_futs: number;
  cout_ht: number;
}
interface FutData {
  scope: string;
  kpis: {
    total_futs: number;
    cout_ht: number;
    nb_types: number;
    nb_matchs: number;
    top_fut: { name: string; futs: number } | null;
  };
  par_type: FutType[];
  par_match: FutMatch[];
}

const euro = (n: number): string =>
  (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const int = (n: number): string => (n ?? 0).toLocaleString('fr-FR');
const card: CSSProperties = { background: '#fff', border: '1px solid #eef1f6', borderRadius: 14, padding: 18 };

export function SuiviFuts({ scope = 'all' }: { scope?: 'all' | string }) {
  const [data, setData] = useState<FutData | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: res } = await supabase.rpc('get_fut_analysis', { p_scope: scope });
      if (active) setData((res as FutData | null) ?? null);
    })();
    return () => {
      active = false;
    };
  }, [scope]);

  const cols = data?.par_match ?? []; // colonnes = matchs
  const rows = data?.par_type ?? []; // lignes = types de fûts
  const maxTot = useMemo(() => Math.max(1, ...rows.map((r) => r.total_futs)), [rows]);
  const futsFor = (r: FutType, ev: string): number =>
    r.par_match?.find((m) => m.event_name === ev)?.futs ?? 0;
  const k = data?.kpis;

  // Masqué tant qu'aucun fût (ex. scope séminaire, ou données non chargées).
  if (!data || (k?.total_futs ?? 0) === 0) return null;

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <div style={{ fontWeight: 700 }}>🛢️ Suivi des fûts {scope === 'all' ? '— tous les matchs' : '— ce match'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 13 }}>
          <span><b style={{ fontSize: 18 }}>{int(k?.total_futs ?? 0)}</b> fûts</span>
          <span><b style={{ fontSize: 18 }}>{euro(k?.cout_ht ?? 0)}</b></span>
          <span>{k?.nb_types ?? 0} types · top <b>{k?.top_fut?.name ?? '—'}</b> ({int(k?.top_fut?.futs ?? 0)})</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#0b1f3a', color: '#fff' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Type de fût</th>
              {cols.map((c) => (
                <th key={c.event_name} style={{ textAlign: 'center', padding: '8px 10px' }}>
                  {c.event_name}
                  <div style={{ fontSize: 10, opacity: 0.7 }}>{new Date(c.event_date).toLocaleDateString('fr-FR')}</div>
                </th>
              ))}
              <th style={{ textAlign: 'center', padding: '8px 10px' }}>Total</th>
              <th style={{ textAlign: 'right', padding: '8px 10px' }}>Coût HT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.product_name} style={{ background: i % 2 ? '#f7f9fc' : '#fff' }}>
                <td style={{ padding: '7px 10px', fontWeight: 600, minWidth: 160 }}>
                  {r.product_name}
                  <div style={{ height: 6, background: '#eef1f6', borderRadius: 4, marginTop: 3 }}>
                    <div style={{ width: `${(r.total_futs / maxTot) * 100}%`, height: '100%', background: '#e8792b', borderRadius: 4 }} />
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c.event_name} style={{ textAlign: 'center', padding: '7px 10px' }}>{int(futsFor(r, c.event_name))}</td>
                ))}
                <td style={{ textAlign: 'center', padding: '7px 10px', fontWeight: 800 }}>{int(r.total_futs)}</td>
                <td style={{ textAlign: 'right', padding: '7px 10px', color: '#5a6472' }}>{euro(r.cout_ht)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #0b1f3a', fontWeight: 800 }}>
              <td style={{ padding: '8px 10px' }}>TOTAL</td>
              {cols.map((c) => (
                <td key={c.event_name} style={{ textAlign: 'center', padding: '8px 10px' }}>{int(c.total_futs)}</td>
              ))}
              <td style={{ textAlign: 'center', padding: '8px 10px' }}>{int(k?.total_futs ?? 0)}</td>
              <td style={{ textAlign: 'right', padding: '8px 10px' }}>{euro(k?.cout_ht ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default SuiviFuts;
