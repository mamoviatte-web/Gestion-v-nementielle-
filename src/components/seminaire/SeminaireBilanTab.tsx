/**
 * Onglet « Bilan » (ROLE_STADE) — consolidation de tous les espaces après un
 * séminaire : avancement par espace, synthèse des stocks avec coût, horaires
 * réels vs prévus, débriefs + photos, et export Excel 3 feuilles.
 *
 * ⚠ Réservé au ROLE_STADE : affiche les coûts (RG-003).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { downloadAoaWorkbook } from '@/lib/xlsxAoa';
import { BarChart3, Download, Image } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { BilanCostTable } from '@/components/seminaire/BilanCostTable';
import { BilanRegisseur } from '@/components/seminaire/BilanRegisseur';
import type { Event } from '@/lib/types';
import type { EventSpaceWithSpace } from '@/hooks/useEvents';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Champs terrain optionnels présents sur l'event_space (horaires réels). */
interface EventSpaceTiming {
  space_actual_arrival?: string | null;
  space_actual_departure?: string | null;
  space_responsible_name?: string | null;
}

/** Ligne de la vue event_stock_summary (prix EFFECTIF = figé prioritaire). */
interface StockLineRow {
  space_id: string;
  product_id: string;
  product_name: string;
  unit: string;
  unit_price_ht: number | null;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number | null;
  consumed_qty: number | null;
  cost_ht: number | null;
  source_name: string | null;
  product_state: string | null;
  responsable_nom: string | null;
}

interface DebriefRow {
  space_id: string;
  responsable: string | null;
  efficacite: string | null;
  stocks_suffisants: string | null;
  suggestions_generales: string | null;
  photo_urls: string[] | null;
  submitted_at: string | null;
}

interface BilanData {
  stockLines: StockLineRow[];
  debriefs: DebriefRow[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

function hm(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : '—';
}

/** Consommation d'une ligne (fournie par la vue : initial + réassort − final). */
function computeConsumed(l: StockLineRow): number {
  return l.consumed_qty ?? l.initial_qty + l.reassort_qty - (l.final_qty ?? 0);
}

/** Coût HT d'une ligne au prix EFFECTIF (figé prioritaire) — via la vue. */
function computeLineCost(l: StockLineRow): number | null {
  return l.cost_ht;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/* Composant                                                           */
/* ------------------------------------------------------------------ */

export function SeminaireBilanTab({
  event,
  spaces,
}: {
  event: Event;
  spaces: EventSpaceWithSpace[];
}) {
  const { showToast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['seminaireBilan', event.event_id],
    queryFn: async (): Promise<BilanData> => {
      const [stockRes, debriefRes] = await Promise.all([
        supabase
          .from('event_stock_summary')
          .select(
            'space_id, product_id, product_name, unit, unit_price_ht, initial_qty, reassort_qty, final_qty, consumed_qty, cost_ht, source_name, product_state, responsable_nom',
          )
          .eq('event_id', event.event_id),
        supabase
          .from('debriefs')
          .select(
            'space_id, responsable, efficacite, stocks_suffisants, suggestions_generales, photo_urls, submitted_at',
          )
          .eq('event_id', event.event_id),
      ]);
      if (stockRes.error) throw stockRes.error;
      if (debriefRes.error) throw debriefRes.error;
      return {
        stockLines: (stockRes.data ?? []) as unknown as StockLineRow[],
        debriefs: (debriefRes.data ?? []) as unknown as DebriefRow[],
      };
    },
  });

  /** Nom d'espace par space_id. */
  const spaceName = useMemo(() => {
    const map = new Map<string, string>();
    spaces.forEach((s) => map.set(s.space_id, s.spaces?.space_name ?? s.space_id));
    return map;
  }, [spaces]);

  const nameOf = (spaceId: string): string => spaceName.get(spaceId) ?? spaceId;

  const stockLines = data?.stockLines ?? [];
  const debriefs = data?.debriefs ?? [];

  const debriefBySpace = useMemo(() => {
    const map = new Map<string, DebriefRow>();
    debriefs.forEach((d) => map.set(d.space_id, d));
    return map;
  }, [debriefs]);

  const totalCost = useMemo(
    () =>
      stockLines.reduce((sum, l) => {
        const c = computeLineCost(l);
        return c !== null ? sum + c : sum;
      }, 0),
    [stockLines],
  );

  /** Lignes de stock affichées (final saisi OU un initial renseigné). */
  const displayedLines = useMemo(
    () => stockLines.filter((l) => l.final_qty !== null || l.initial_qty > 0),
    [stockLines],
  );

  /** Avancement 0-100 % par espace (3 jalons : initial, final, débrief). */
  const progressOf = (spaceId: string): number => {
    const lines = stockLines.filter((l) => l.space_id === spaceId);
    const hasInitial = lines.some((l) => l.initial_qty > 0);
    const hasFinal = lines.some((l) => l.final_qty !== null);
    const debrief = debriefBySpace.get(spaceId);
    const hasDebrief = !!debrief?.submitted_at;
    const done = [hasInitial, hasFinal, hasDebrief].filter(Boolean).length;
    return Math.round((done / 3) * 100);
  };

  /* ------------------------------ Export ------------------------------ */

  async function handleExport(): Promise<void> {
    const stockAoa: (string | number)[][] = [
      [`BILAN STOCKS — ${event.event_name} — ${formatDate(event.event_date)}`],
      [],
      ['Produit', 'Espace', 'Source', 'Initial', 'Final', 'Consommé', 'Coût HT (€)', 'Responsable'],
    ];
    displayedLines.forEach((l) => {
      const cost = computeLineCost(l);
      stockAoa.push([
        l.product_name ?? l.product_id,
        nameOf(l.space_id),
        l.source_name ?? '',
        l.initial_qty,
        l.final_qty ?? '',
        computeConsumed(l),
        cost !== null ? Number(cost.toFixed(2)) : '',
        l.responsable_nom ?? '',
      ]);
    });
    stockAoa.push([]);
    stockAoa.push(['Coût total estimé', '', '', '', '', '', Number(totalCost.toFixed(2)), '']);

    const planned = hm(event.start_time);
    const scheduleAoa: (string | number)[][] = [
      [`HORAIRES TERRAIN — ${event.event_name}`],
      [],
      ['Espace', 'Responsable', 'Prévu', 'Arrivée réelle', 'Départ réel', 'Écart'],
    ];
    spaces.forEach((s) => {
      const t = s as EventSpaceWithSpace & EventSpaceTiming;
      const arrival = t.space_actual_arrival ?? null;
      const gap =
        event.start_time && arrival
          ? toMinutes(arrival.slice(0, 5)) - toMinutes(planned)
          : null;
      scheduleAoa.push([
        nameOf(s.space_id),
        t.space_responsible_name ?? '',
        planned,
        hm(arrival),
        hm(t.space_actual_departure),
        gap === null ? '⏳' : `${gap >= 0 ? '+' : ''}${gap}min`,
      ]);
    });

    const debriefAoa: (string | number)[][] = [
      [`DÉBRIEFS — ${event.event_name}`],
      [],
      ['Espace', 'Responsable', 'Efficacité', 'Stocks suffisants', 'Suggestions', 'Photos'],
    ];
    spaces.forEach((s) => {
      const d = debriefBySpace.get(s.space_id);
      debriefAoa.push([
        nameOf(s.space_id),
        d?.responsable ?? '',
        d?.efficacite ?? '',
        d?.stocks_suffisants ?? '',
        d?.suggestions_generales ?? '',
        d?.photo_urls?.length ?? 0,
      ]);
    });

    await downloadAoaWorkbook(
      [
        { name: 'Stocks', aoa: stockAoa, widths: [26, 18, 12, 9, 9, 11, 13, 18] },
        { name: 'Horaires', aoa: scheduleAoa, widths: [18, 20, 10, 14, 14, 10] },
        { name: 'Débriefs', aoa: debriefAoa, widths: [18, 20, 12, 16, 40, 8] },
      ],
      `Bilan_${event.event_name}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    showToast('Bilan Excel exporté.', 'success');
  }

  function handleDownloadPhotos(): void {
    const urls = debriefs.flatMap((d) => d.photo_urls ?? []);
    if (urls.length === 0) {
      showToast('Aucune photo à télécharger.', 'info');
      return;
    }
    urls.forEach((url) => window.open(url, '_blank', 'noopener,noreferrer'));
    showToast(`${urls.length} photo(s) ouverte(s).`, 'success');
  }

  /* ------------------------------ Rendu ------------------------------- */

  if (isLoading) {
    return <Spinner label="Chargement du bilan…" />;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <BarChart3 className="h-5 w-5 text-pr-olive-dark" aria-hidden />
            Bilan {event.event_name}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {formatDate(event.event_date)} · {event.expected_attendees ?? '—'} participants
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleDownloadPhotos}>
            <Image className="mr-1.5 h-4 w-4" aria-hidden />
            📸 Télécharger toutes les photos
          </Button>
          <Button onClick={handleExport}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden />
            📥 Exporter le bilan Excel
          </Button>
        </div>
      </div>

      {/* 1 — Avancement --------------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Avancement par espace
        </h3>
        {spaces.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun espace activé pour cet événement.</p>
        ) : (
          <div className="space-y-2">
            {spaces.map((s) => {
              const pct = progressOf(s.space_id);
              const debrief = debriefBySpace.get(s.space_id);
              const timing = s as EventSpaceWithSpace & EventSpaceTiming;
              const lines = stockLines.filter((l) => l.space_id === s.space_id);
              const closed = lines.length > 0 && lines.every((l) => l.final_qty !== null);
              let status: string;
              if (debrief?.submitted_at) {
                status = `Débrief soumis + ${debrief.photo_urls?.length ?? 0} photos`;
              } else if (closed) {
                status = 'Clôture ✅';
              } else {
                status = 'En attente';
              }
              return (
                <div
                  key={s.space_id}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center"
                >
                  <div className="w-full sm:w-48 sm:shrink-0">
                    <p className="text-sm font-medium text-slate-900">{nameOf(s.space_id)}</p>
                    <p className="text-xs text-slate-500">
                      {timing.space_responsible_name ?? 'Responsable —'}
                    </p>
                  </div>
                  <div className="flex-1">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-pr-olive-dark transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:w-56 sm:justify-end">
                    <span className="text-xs font-semibold text-slate-600">{pct}%</span>
                    <Badge tone={pct === 100 ? 'success' : pct > 0 ? 'info' : 'neutral'}>
                      {status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2 — Synthèse des coûts (prix U × consommé) ----------------------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Synthèse des coûts F&amp;B
        </h3>
        <p className="text-xs text-slate-400">
          Coût = prix unitaire HT × consommé (initial + réassort − final). Survolez un produit pour la formule.
        </p>
        <BilanCostTable eventId={event.event_id} />
      </section>

      {/* 3 — Horaires régisseur + charges RH ------------------------------ */}
      <BilanRegisseur event={event} />

      {/* 4 — Débriefs & photos -------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Débriefs &amp; photos
        </h3>
        {spaces.length === 0 ? (
          <EmptyState icon={BarChart3} title="Aucun espace à débriefer" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {spaces.map((s) => {
              const d = debriefBySpace.get(s.space_id);
              const photos = d?.photo_urls ?? [];
              return (
                <div
                  key={s.space_id}
                  className="space-y-2 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-900">{nameOf(s.space_id)}</p>
                    {d?.submitted_at ? (
                      <Badge tone="success">Débrief soumis</Badge>
                    ) : (
                      <Badge tone="neutral">⏳ En attente</Badge>
                    )}
                  </div>
                  {d?.submitted_at ? (
                    <div className="space-y-1.5 text-sm text-slate-600">
                      {d.efficacite && (
                        <p>
                          <span className="font-medium text-slate-700">Efficacité :</span>{' '}
                          <Badge tone="info">⭐ {d.efficacite}</Badge>
                        </p>
                      )}
                      {d.stocks_suffisants && (
                        <p>
                          <span className="font-medium text-slate-700">Stocks suffisants :</span>{' '}
                          {d.stocks_suffisants}
                        </p>
                      )}
                      {d.suggestions_generales && (
                        <p className="text-slate-500">{d.suggestions_generales}</p>
                      )}
                      {photos.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {photos.map((url, idx) => (
                            <img
                              key={idx}
                              src={url}
                              alt={`Photo ${idx + 1} — ${nameOf(s.space_id)}`}
                              className="h-16 w-16 rounded object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">⏳ En attente</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Alert variant="info" title="Rappel">
        Ce bilan et son export contiennent les coûts HT — réservé au rôle Stade (RG-003).
      </Alert>
    </div>
  );
}
