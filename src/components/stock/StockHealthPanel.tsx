/**
 * StockHealthPanel — santé du stock : valorisation (par catégorie) & couverture
 * (nombre de matchs couverts par le stock total, = stock / conso moyenne par
 * match). Signale les ruptures et surstocks. ROLE_STADE (valeurs). Lecture seule.
 */

import { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw, AlertTriangle, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge, Card, SectionTitle, Spinner, StatTile } from '@/components/ui';

interface Alerte {
  product_name: string; category: string; conso_moy: number;
  stock_total: number; couverture: number | null; statut: 'rupture' | 'tendu' | 'surstock' | 'sain';
}
interface Health {
  success: boolean; valeur_totale_ht: number;
  valorisation: { category: string; valeur_ht: number; unites: number }[];
  resume: { rupture: number; tendu: number; sain: number; surstock: number };
  alertes: Alerte[];
}

const eur0 = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} € HT`;
const STATUT: Record<string, { tone: 'danger' | 'warning' | 'info'; label: string }> = {
  rupture: { tone: 'danger', label: 'rupture' },
  tendu: { tone: 'warning', label: 'tendu' },
  surstock: { tone: 'info', label: 'surstock' },
};

export function StockHealthPanel() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: d } = await supabase.rpc('stock_health_overview');
    setData((d as Health | null) ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <Card><Spinner label="Santé du stock…" /></Card>;
  if (!data?.success) return null;

  const maxVal = Math.max(1, ...data.valorisation.map((v) => v.valeur_ht));
  const ruptures = data.alertes.filter((a) => a.statut === 'rupture' || a.statut === 'tendu');
  const surstocks = data.alertes.filter((a) => a.statut === 'surstock').slice(0, 6);

  return (
    <Card accent={data.resume.rupture > 0 ? 'rust' : 'gold'}>
      <SectionTitle
        icon={Gauge}
        right={
          <button onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-pr-black-soft/45 hover:text-pr-black-soft/70">
            <RefreshCw size={12} /> Rafraîchir
          </button>
        }
      >
        Santé du stock — valorisation &amp; couverture
      </SectionTitle>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Valeur du stock" value={eur0(data.valeur_totale_ht)} />
        <StatTile label="En rupture" value={data.resume.rupture} tone={data.resume.rupture > 0 ? 'crit' : 'good'} sub="< 1 match" />
        <StatTile label="Tendu" value={data.resume.tendu} tone={data.resume.tendu > 0 ? 'warn' : 'default'} sub="1–2 matchs" />
        <StatTile label="Surstock" value={data.resume.surstock} sub="> 5 matchs" />
      </div>

      {/* Valorisation par catégorie */}
      <div className="mb-4 space-y-1.5">
        {data.valorisation.map((v) => (
          <div key={v.category} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-pr-black-soft/70">{v.category}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-pr-stone/40">
              <div className="h-full rounded bg-pr-olive/70" style={{ width: `${(v.valeur_ht / maxVal) * 100}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right tabular-nums font-medium text-pr-black">{eur0(v.valeur_ht)}</span>
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-pr-black-soft/45">{v.unites} u</span>
          </div>
        ))}
      </div>

      {/* Alertes rupture / tendu */}
      {ruptures.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-pr-rust">
            <AlertTriangle size={13} /> Risque de rupture ({ruptures.length})
          </p>
          <div className="space-y-1">
            {ruptures.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-pr-stone/70 bg-white px-3 py-1.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-pr-black">{a.product_name}</span>
                  <span className="ml-2 text-xs text-pr-black-soft/45">{a.category} · conso ~{a.conso_moy}/match · stock {a.stock_total}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs tabular-nums text-pr-black-soft/60">{a.couverture ?? 0} match(s)</span>
                  <Badge tone={STATUT[a.statut].tone}>{STATUT[a.statut].label}</Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Surstocks (capital immobilisé) */}
      {surstocks.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-pr-black-soft/45">
            <TrendingUp size={13} /> Surstock — capital immobilisé
          </p>
          <div className="flex flex-wrap gap-1.5">
            {surstocks.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-pr-stone bg-pr-cream/50 px-2.5 py-1 text-xs">
                <span className="font-medium text-pr-black">{a.product_name}</span>
                <span className="tabular-nums text-pr-black-soft/50">{a.couverture} matchs</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
