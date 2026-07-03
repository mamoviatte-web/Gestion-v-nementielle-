/**
 * CostControlPage (/admin/analytics/costs) — Contrôle de charges F&B.
 * KPIs coût/pax, décomposition par catégorie, comparatif événements, produits
 * les plus coûteux, surdotations détectées, produits sans prix.
 * Réservé ROLE_STADE (coûts — RG-003).
 */

import { useMemo, useState } from 'react';
import {
  DollarSign,
  Presentation,
  Trophy,
  AlertTriangle,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, EmptyState, Select, Spinner } from '@/components/ui';
import { formatEuro } from '@/lib/calculations';
import { useCostControl, type CostControlFilters } from '@/hooks/useCostControl';

const CATEGORY_COLORS: Record<string, string> = {
  Vins: 'bg-pr-rust',
  Bières: 'bg-pr-gold',
  Soft: 'bg-sky-500',
  Sirops: 'bg-pink-400',
  Spiritueux: 'bg-pr-olive',
  Matériel: 'bg-pr-stone',
};

function eur2(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(2)} €`;
}

function frDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const TYPE_LABEL: Record<string, string> = {
  match: 'Match',
  séminaire: 'Séminaire',
  cocktail: 'Cocktail',
  réception_vip: 'Réception VIP',
  événement_partenaire: 'Partenaire',
  réunion: 'Réunion',
  autre: 'Autre',
};

export default function CostControlPage() {
  const [eventType, setEventType] = useState<CostControlFilters['eventType']>('all');
  const [year, setYear] = useState<string>('all');

  const filters: CostControlFilters = useMemo(
    () => ({ eventType, year: year === 'all' ? 'all' : Number(year) }),
    [eventType, year],
  );
  const { data, isLoading } = useCostControl(filters);

  if (isLoading) return <Spinner fullPage label="Chargement du contrôle de charges…" />;
  if (!data) {
    return <EmptyState icon={DollarSign} title="Données indisponibles" />;
  }

  const yearOptions = [
    { value: 'all', label: 'Toutes saisons' },
    ...data.years.map((y) => ({ value: String(y), label: `Saison ${y}` })),
  ];
  const typeOptions = [
    { value: 'all', label: 'Tous types' },
    { value: 'match', label: 'Matchs' },
    { value: 'séminaire', label: 'Séminaires & autres' },
  ];

  const maxCatTotal = Math.max(
    1,
    ...data.categoryBreakdown.map((e) => Object.values(e.byCat).reduce((s, n) => s + n, 0)),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Contrôle de charges"
        description="Coûts F&B réels par événement — prix unitaire × consommation. Provence Rugby / Stade Maurice-David."
      />

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <div className="w-44">
          <Select
            label="Saison"
            options={yearOptions}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <div className="w-52">
          <Select
            label="Type d'événement"
            options={typeOptions}
            value={eventType ?? 'all'}
            onChange={(e) => setEventType(e.target.value as CostControlFilters['eventType'])}
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="F&B / pax — match" value={eur2(data.kpis.avg_match_per_pax)} sub="moyenne saison" icon={Trophy} />
        <KpiCard label="F&B / pax — séminaire" value={eur2(data.kpis.avg_seminar_per_pax)} sub="moyenne saison" icon={Presentation} />
        <KpiCard label="F&B / pax — global" value={eur2(data.kpis.avg_cost_per_pax)} sub={`Total F&B ${formatEuro(data.kpis.total_fb_ht)}`} icon={DollarSign} />
      </div>

      {/* Décomposition par catégorie */}
      <section className="space-y-3">
        <SectionTitle>Décomposition par catégorie</SectionTitle>
        {data.categoryBreakdown.length === 0 ? (
          <p className="text-sm text-pr-black-soft/50">Aucun coût sur la période sélectionnée.</p>
        ) : (
          <div className="space-y-3 rounded-xl border border-pr-stone bg-white p-4">
            {data.categoryBreakdown.map((e) => {
              const total = Object.values(e.byCat).reduce((s, n) => s + n, 0);
              return (
                <div key={e.event_id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-pr-black">{e.event_name}</span>
                    <span className="text-pr-black-soft/60">{formatEuro(total)}</span>
                  </div>
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-pr-stone/40">
                    {Object.entries(e.byCat)
                      .filter(([, v]) => v > 0)
                      .map(([cat, v]) => (
                        <div
                          key={cat}
                          className={`h-full ${CATEGORY_COLORS[cat] ?? 'bg-pr-stone'}`}
                          style={{ width: `${(total / maxCatTotal) * (v / total) * 100}%` }}
                          title={`${cat} · ${formatEuro(v)}`}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-3 pt-1">
              {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                <span key={cat} className="flex items-center gap-1.5 text-xs text-pr-black-soft/60">
                  <span className={`h-2.5 w-2.5 rounded-full ${color}`} /> {cat}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Comparatif événements */}
      <section className="space-y-3">
        <SectionTitle>Comparatif événements</SectionTitle>
        {data.summaries.length === 0 ? (
          <EmptyState icon={DollarSign} title="Aucun événement chiffré" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-pr-stone bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pr-stone text-left text-xs uppercase tracking-wide text-pr-black-soft/60">
                  <th className="px-4 py-2.5 font-semibold">Événement</th>
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 text-right font-semibold">PAX</th>
                  <th className="px-4 py-2.5 text-right font-semibold">F&B HT</th>
                  <th className="px-4 py-2.5 text-right font-semibold">F&B TTC</th>
                  <th className="px-4 py-2.5 text-right font-semibold">€/pax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pr-stone">
                {data.summaries.map((s) => (
                  <tr key={s.event_id} className="hover:bg-pr-cream/40">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-pr-black">{s.event_name}</span>
                      {s.event_type && (
                        <Badge tone="neutral" className="ml-2">
                          {TYPE_LABEL[s.event_type] ?? s.event_type}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-pr-black-soft/70">{frDate(s.event_date)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-pr-black-soft/70">
                      {(s.pax ?? 0).toLocaleString('fr-FR')}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-pr-black">
                      {formatEuro(s.total_fb_cost_ht ?? 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-pr-black-soft/70">
                      {formatEuro(s.total_fb_cost_ttc ?? 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-pr-black">
                      {eur2(s.fb_cost_per_pax)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Produits les plus coûteux */}
      <section className="space-y-3">
        <SectionTitle>Produits les plus coûteux</SectionTitle>
        {data.topProducts.length === 0 ? (
          <p className="text-sm text-pr-black-soft/50">Aucune consommation chiffrée.</p>
        ) : (
          <ol className="divide-y divide-pr-stone rounded-xl border border-pr-stone bg-white">
            {data.topProducts.map((p, i) => (
              <li key={p.product_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-6 text-center font-display text-sm font-black text-pr-black-soft/40">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-pr-black">{p.product_name}</p>
                  <p className="text-xs text-pr-black-soft/50">
                    {p.category} · {p.events_count} événement(s)
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-pr-black">{formatEuro(p.total_cost_ht)}</p>
                  <p className="text-xs text-pr-black-soft/50">{formatEuro(p.avg_cost_per_event)}/event</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Surdotations détectées */}
      <section className="space-y-3">
        <SectionTitle>Surdotations détectées</SectionTitle>
        {data.overdotations.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-800">
            <TrendingDown className="h-5 w-5 shrink-0 text-emerald-600" />
            Aucune surdotation coûteuse (&gt; 50 € immobilisés) détectée.
          </div>
        ) : (
          <ul className="space-y-2">
            {data.overdotations.map((o, i) => (
              <li
                key={`${o.event_id}-${o.product_name}-${i}`}
                className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-pr-black">
                      {o.product_name} — {o.space_name} · {o.event_name}
                    </p>
                    <p className="text-xs text-pr-black-soft/70">
                      Dotation {o.total_dotation} · consommé {o.consumed} · retour {o.returned} (
                      {Math.round(o.return_rate * 100)} %)
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-amber-700">
                      Coût immobilisé : {formatEuro(o.immobilized_cost_ht)} HT
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Produits sans prix */}
      {data.noPriceProducts.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Produits sans prix (hors totaux)</SectionTitle>
          <div className="rounded-xl border border-pr-stone bg-white p-4">
            <p className="mb-2 text-sm text-pr-black-soft/70">
              {data.noPriceProducts.length} produit(s) sans prix HT — non inclus dans les coûts (RG-005).
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.noPriceProducts.map((p) => (
                <Badge key={p.product_id} tone="warning">
                  {p.product_name}
                </Badge>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────── Bits ─────────────────────────── */

function SectionTitle({ children }: { children: string }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wide text-pr-black-soft/60">{children}</h2>;
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-t-[3px] border-pr-stone border-t-pr-olive bg-white p-4">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-pr-olive-dark">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-pr-olive-dark" />
      </div>
      <p className="mt-1 font-display text-3xl font-black text-pr-black">{value}</p>
      <p className="mt-0.5 truncate text-xs text-pr-black-soft/50">{sub}</p>
    </div>
  );
}
