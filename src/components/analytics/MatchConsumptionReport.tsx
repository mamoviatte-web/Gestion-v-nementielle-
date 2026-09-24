/**
 * MatchConsumptionReport — rapport de consommation d'un match séparé
 * Grand Public (buvettes B1-B9) vs VIP & Bars. Deux KPIs + deux tableaux
 * (le Grand Public est regroupé par produit toutes buvettes confondues).
 */

import { useMemo } from 'react';
import { Alert, Badge, Card, EmptyState, Spinner, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { useMatchConsumptionReport, type MatchConsumptionLine } from '@/hooks/useMatchConsumptionReport';
import { Beer, Star, TrendingUp } from 'lucide-react';

function num(v: number | null, digits = 1): string {
  return v == null ? '—' : v.toFixed(digits);
}

// Palette validée (dataviz) : VIP gold / Bar rust — ΔE CVD 28.6, étiquettes
// directes obligatoires (contraste gold/surface < 3:1). Buvette = olive (série unique).
const TONE_COLOR: Record<string, string> = { vip: '#C9A646', bar: '#8A3B1F', gp: '#6B7548' };
const TONE_LABEL: Record<string, string> = { vip: 'VIP', bar: 'Bar', gp: 'Buvette' };

interface SpaceBar { key: string; label: string; tone: string; cost: number; conso: number }

/**
 * Barres horizontales pour COMPARER les espaces (magnitude) : longueur ∝ coût,
 * couleur = type d'espace (identité), valeur en étiquette directe, tri décroissant.
 * Survol = détail (coût + conso). Légende présente dès 2 couleurs.
 */
function SpaceBarChart({ title, bars, legendTones }: { title: string; bars: SpaceBar[]; legendTones: string[] }) {
  if (bars.length === 0) return null;
  const max = Math.max(1, ...bars.map((b) => b.cost));
  return (
    <div className="rounded-2xl border border-pr-stone bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-pr-black">{title}</h4>
        {legendTones.length > 1 && (
          <div className="flex items-center gap-3 text-[11px] text-pr-black-soft/60">
            {legendTones.map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TONE_COLOR[t] }} aria-hidden />
                {TONE_LABEL[t]}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {bars.map((b) => {
          const pct = Math.max(0, (b.cost / max) * 100);
          return (
            <div
              key={b.key}
              className="flex items-center gap-3"
              title={`${b.label} · ${formatEuro(b.cost)} · conso ${b.conso}`}
            >
              <span className="w-24 shrink-0 truncate text-xs font-medium text-pr-black-soft/80 sm:w-32">{b.label}</span>
              <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-pr-stone/40">
                <div
                  className="h-full rounded-md transition-all"
                  style={{ width: `${pct}%`, background: TONE_COLOR[b.tone] ?? TONE_COLOR.gp }}
                />
              </div>
              <span className={`w-20 shrink-0 text-right text-xs font-semibold tabular-nums ${b.cost < 0 ? 'text-pr-rust' : 'text-pr-black'}`}>
                {formatEuro(b.cost)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MatchConsumptionReport({ eventId }: { eventId: string }) {
  const { data, isLoading } = useMatchConsumptionReport(eventId);

  const vip = useMemo(() => (data?.lines ?? []).filter((l) => l.consumption_category !== 'Grand Public'), [data]);
  const gp = useMemo(() => (data?.lines ?? []).filter((l) => l.consumption_category === 'Grand Public'), [data]);

  // Grand Public : regroupé par produit (toutes buvettes).
  const gpByProduct = useMemo(() => {
    const map = new Map<string, { name: string; category: string; unit: string; consumed: number; cost: number; hasCost: boolean }>();
    for (const l of gp) {
      const e = map.get(l.product_id) ?? { name: l.product_name, category: l.category, unit: l.unit, consumed: 0, cost: 0, hasCost: false };
      e.consumed += l.consumed_qty;
      if (l.cost_ht != null) {
        e.cost += l.cost_ht;
        e.hasCost = true;
      }
      map.set(l.product_id, e);
    }
    return [...map.values()].sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.name.localeCompare(b.name, 'fr'));
  }, [gp]);

  // Agrégats par espace pour la comparaison visuelle (coût + conso).
  const vipBySpace = useMemo<SpaceBar[]>(() => {
    const m = new Map<string, SpaceBar>();
    for (const l of vip) {
      const e = m.get(l.space_id) ?? { key: l.space_id, label: l.space_name, tone: l.service_type === 'vip' ? 'vip' : 'bar', cost: 0, conso: 0 };
      e.cost += l.cost_ht ?? 0;
      e.conso += l.final_qty === null ? 0 : l.consumed_qty;
      m.set(l.space_id, e);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  }, [vip]);

  const gpBySpace = useMemo<SpaceBar[]>(() => {
    const m = new Map<string, SpaceBar>();
    for (const l of gp) {
      const e = m.get(l.space_id) ?? { key: l.space_id, label: l.space_name, tone: 'gp', cost: 0, conso: 0 };
      e.cost += l.cost_ht ?? 0;
      e.conso += l.consumed_qty;
      m.set(l.space_id, e);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  }, [gp]);

  const totalVipCost = vip.reduce((s, l) => s + (l.cost_ht ?? 0), 0);
  const totalGpCost = gp.reduce((s, l) => s + (l.cost_ht ?? 0), 0);
  const vipClosed = vip.filter((l) => l.final_qty !== null).length;

  if (isLoading) return <Spinner label="Chargement du rapport…" />;

  if (data && !data.provisioned) {
    return (
      <Alert variant="warning" title="Vue non provisionnée">
        Applique <code>supabase/buvettes_capacites.sql</code> pour activer le rapport
        (vue <code>match_consumption_report</code> + colonnes capacités).
      </Alert>
    );
  }

  if (vip.length === 0 && gp.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Aucune ligne de consommation"
        message="Les données apparaîtront après saisie des stocks initiaux/finaux par espace."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs séparés */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card accent="gold" pad="sm">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-pr-black-soft/50">
            <Star className="h-3.5 w-3.5" /> VIP &amp; Bars
          </p>
          <p className="mt-1 font-display text-2xl font-black text-pr-black">{formatEuro(totalVipCost)}</p>
          <p className="mt-1 text-xs text-pr-black-soft/50">{vipClosed} ligne(s) clôturée(s)</p>
        </Card>
        <Card accent="olive" pad="sm">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-pr-black-soft/50">
            <Beer className="h-3.5 w-3.5" /> Grand Public
          </p>
          <p className="mt-1 font-display text-2xl font-black text-pr-black">{formatEuro(totalGpCost)}</p>
          <p className="mt-1 text-xs text-pr-black-soft/50">Buvettes B1–B9</p>
        </Card>
      </div>

      {/* Comparaison visuelle des espaces (coût F&B) */}
      {(vipBySpace.length > 0 || gpBySpace.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SpaceBarChart title="Coût F&B par espace — VIP & Bars" bars={vipBySpace} legendTones={['vip', 'bar']} />
          <SpaceBarChart title="Coût F&B par buvette — Grand Public" bars={gpBySpace} legendTones={['gp']} />
        </div>
      )}

      {/* Tableau VIP & Bars */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-pr-black">
          <Star className="h-4 w-4 text-pr-gold" /> VIP &amp; Bars
        </h3>
        {vip.length === 0 ? (
          <p className="text-sm text-pr-black-soft">Aucun espace VIP/Bar activé sur ce match.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-pr-stone/40">
            <Table>
              <THead>
                <TR>
                  <TH>Espace</TH>
                  <TH>Produit</TH>
                  <TH>Famille</TH>
                  <TH className="text-right">Pax</TH>
                  <TH className="text-right">Conso</TH>
                  <TH className="text-right">Ratio/100</TH>
                  <TH className="text-right">Coût HT</TH>
                </TR>
              </THead>
              <TBody>
                {vip.map((l) => (
                  <TR key={`${l.space_id}:${l.product_id}`}>
                    <TD className="font-medium text-pr-black">
                      {l.space_name}
                      <Badge tone={l.service_type === 'vip' ? 'warning' : 'neutral'} className="ml-2">
                        {l.service_type === 'vip' ? 'VIP' : 'Bar'}
                      </Badge>
                    </TD>
                    <TD>{l.product_name}</TD>
                    <TD className="text-pr-black-soft">{l.category}</TD>
                    <TD className="text-right tabular-nums">{l.expected_pax ?? l.max_pax ?? '—'}</TD>
                    <TD className="text-right tabular-nums font-medium">{l.final_qty === null ? '—' : l.consumed_qty}</TD>
                    <TD className="text-right tabular-nums text-pr-black-soft">{num(l.qty_per_100pax, 2)}</TD>
                    <TD className="text-right tabular-nums">{l.cost_ht == null ? '—' : formatEuro(l.cost_ht)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      {/* Tableau Grand Public — groupé par produit */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-pr-black">
          <Beer className="h-4 w-4 text-pr-olive" /> Grand Public — Buvettes
        </h3>
        {gpByProduct.length === 0 ? (
          <p className="text-sm text-pr-black-soft">Aucune consommation buvette saisie.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-pr-stone/40">
            <Table>
              <THead>
                <TR>
                  <TH>Produit</TH>
                  <TH>Famille</TH>
                  <TH className="text-right">Conso totale</TH>
                  <TH className="text-right">Coût HT</TH>
                </TR>
              </THead>
              <TBody>
                {gpByProduct.map((p) => (
                  <TR key={p.name}>
                    <TD className="font-medium text-pr-black">{p.name}</TD>
                    <TD className="text-pr-black-soft">{p.category}</TD>
                    <TD className="text-right tabular-nums font-medium">
                      {p.consumed} {p.unit}
                    </TD>
                    <TD className="text-right tabular-nums">{p.hasCost ? formatEuro(p.cost) : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Ré-export pour signature homogène avec les autres onglets. */
export type { MatchConsumptionLine };
