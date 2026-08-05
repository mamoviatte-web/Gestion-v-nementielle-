/**
 * Rapports horaires mensuels par agent (analytics ROLE_STADE).
 *
 * Route : /admin/analytics/staff/monthly
 * Agrège les heures prévues / réelles / supplémentaires par agent sur un mois,
 * à partir de la table `monthly_staff_reports` (générée via RPC côté serveur).
 * Réservé au ROLE_STADE — exports comptabilité & RH (Excel + PDF).
 */

import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Users,
  Download,
  FileText,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import {
  Button,
  Badge,
  Alert,
  Select,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState,
  Spinner,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface EventDetail {
  event_name: string;
  event_date: string;
  space_name: string;
  planned_h: number | null;
  actual_h: number | null;
  confirmed: boolean;
}

interface SpaceRef {
  space_name: string;
}

interface MonthlyReport {
  id: string;
  staff_name: string;
  space_id: string | null;
  report_month: string;
  total_events: number;
  total_planned_h: number | null;
  total_actual_h: number | null;
  total_overtime_h: number | null;
  events_detail: EventDetail[] | null;
  generated_at: string;
  spaces: SpaceRef | null;
}

interface SpaceRow {
  space_id: string;
  space_name: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Construit la valeur `YYYY-MM-01` d'un mois donné. */
function monthValue(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
}

/** Libellé français d'un mois ("Août 2026"). */
function monthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
}

/** Options des ~12 derniers mois (mois courant en tête). */
function buildMonthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = monthValue(d.getFullYear(), d.getMonth());
    const label = monthLabel(d.getFullYear(), d.getMonth());
    options.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return options;
}

/** Formate un nombre d'heures ("7.5h" ou "—"). */
function formatHours(value: number | null): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}h`;
}

/** Date fr-FR courte (jj/mm/aaaa). */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Nom de feuille Excel valide (≤ 31 car., caractères interdits retirés). */
function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Agent';
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 28)} ${n}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/* ------------------------------------------------------------------ */
/* Composant                                                           */
/* ------------------------------------------------------------------ */

export default function MonthlyStaffReportsPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const monthOptions = useMemo(buildMonthOptions, []);

  const [month, setMonth] = useState<string>(() => monthOptions[0]?.value ?? '');
  const [spaceFilter, setSpaceFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  /* -------- Espaces (pour le filtre + fallback nom) -------- */
  const spacesQuery = useQuery({
    queryKey: ['spaces'],
    queryFn: async (): Promise<SpaceRow[]> => {
      const { data, error } = await supabase
        .from('spaces')
        .select('space_id, space_name')
        .order('space_name');
      if (error) throw error;
      return (data ?? []) as SpaceRow[];
    },
  });

  const spaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    (spacesQuery.data ?? []).forEach((s) => map.set(s.space_id, s.space_name));
    return map;
  }, [spacesQuery.data]);

  const spaceOptions = useMemo(
    () => [
      { value: 'all', label: 'Tous' },
      ...(spacesQuery.data ?? []).map((s) => ({
        value: s.space_id,
        label: s.space_name,
      })),
    ],
    [spacesQuery.data],
  );

  /* -------- Rapports mensuels -------- */
  const reportsQuery = useQuery({
    queryKey: ['monthlyReports', month, spaceFilter],
    enabled: month !== '',
    queryFn: async (): Promise<MonthlyReport[]> => {
      let query = supabase
        .from('monthly_staff_reports')
        .select(
          'id, staff_name, space_id, report_month, total_events, total_planned_h, total_actual_h, total_overtime_h, events_detail, generated_at, spaces(space_name)',
        )
        .eq('report_month', month);
      if (spaceFilter !== 'all') {
        query = query.eq('space_id', spaceFilter);
      }
      const { data, error } = await query.order('total_overtime_h', {
        ascending: false,
        nullsFirst: false,
      });
      if (error) throw error;
      return (data ?? []) as unknown as MonthlyReport[];
    },
  });

  const rawReports = reportsQuery.data ?? [];

  /* -------- Défense anti-orphelins --------
   * `monthly_staff_reports` est un snapshot SANS clé étrangère vers events :
   * si un événement est supprimé, ses lignes de rapport persistent (le RPC de
   * régénération ne purge pas). On recroise ici avec les événements réellement
   * existants → on masque les rapports 100 % orphelins et on recalcule les
   * totaux des rapports partiellement orphelins. */
  const liveEventsQuery = useQuery({
    queryKey: ['liveEventNames'],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from('events').select('event_name');
      if (error) throw error;
      return new Set((data ?? []).map((e) => (e as { event_name: string }).event_name));
    },
  });

  const reports = useMemo<MonthlyReport[]>(() => {
    const live = liveEventsQuery.data;
    if (!live) return rawReports; // pas encore chargé : ne rien masquer
    const cleaned: MonthlyReport[] = [];
    for (const r of rawReports) {
      const all = r.events_detail ?? [];
      const kept = all.filter((d) => live.has(d.event_name));
      if (all.length > 0 && kept.length === 0) continue; // 100 % orphelin → masquer
      if (kept.length === all.length) {
        cleaned.push(r);
        continue;
      }
      // Rapport partiellement orphelin → recalcul depuis les événements survivants.
      const planned = kept.reduce((s, d) => s + (d.planned_h ?? 0), 0);
      const actual = kept.reduce((s, d) => s + (d.actual_h ?? 0), 0);
      const overtime = kept.reduce((s, d) => s + Math.max(0, (d.actual_h ?? 0) - (d.planned_h ?? 0)), 0);
      cleaned.push({
        ...r,
        events_detail: kept,
        total_events: kept.length,
        total_planned_h: planned,
        total_actual_h: actual,
        total_overtime_h: overtime,
      });
    }
    return cleaned;
  }, [rawReports, liveEventsQuery.data]);

  /* -------- Taux horaires par (agent × espace) pour le coût RH -------- */
  const ratesQuery = useQuery({
    queryKey: ['staffRates', month],
    enabled: month !== '',
    queryFn: async (): Promise<Map<string, number>> => {
      const start = month; // YYYY-MM-01
      const end = new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 1)
        .toISOString()
        .slice(0, 10);
      const { data, error } = await supabase
        .from('schedules')
        .select('staff_name, space_id, hourly_rate, events!inner(event_date)')
        .not('hourly_rate', 'is', null)
        .gte('events.event_date', start)
        .lt('events.event_date', end);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of (data ?? []) as { staff_name: string; space_id: string; hourly_rate: number }[]) {
        const key = `${r.staff_name}|${r.space_id}`;
        const rate = Number(r.hourly_rate);
        map.set(key, Math.max(map.get(key) ?? 0, rate));
      }
      return map;
    },
  });

  /** Taux horaire d'un rapport (agent × espace), null si non renseigné. */
  function rateFor(report: MonthlyReport): number | null {
    if (!report.space_id) return null;
    return ratesQuery.data?.get(`${report.staff_name}|${report.space_id}`) ?? null;
  }

  /** Coût RH d'un rapport = heures réelles × taux. */
  function costFor(report: MonthlyReport): number | null {
    const rate = rateFor(report);
    if (rate == null) return null;
    return (report.total_actual_h ?? 0) * rate;
  }

  /** Résout le nom d'espace via le join, sinon la carte de secours. */
  function resolveSpaceName(report: MonthlyReport): string {
    return (
      report.spaces?.space_name ??
      (report.space_id ? spaceNameById.get(report.space_id) : undefined) ??
      '—'
    );
  }

  /* -------- Génération / recalcul via RPC -------- */
  async function handleGenerate() {
    if (!month) return;
    setIsGenerating(true);
    try {
      const { error } = await supabase.rpc('generate_monthly_staff_report', {
        p_month: month,
      });
      if (error) throw error;
      showToast('Rapport recalculé.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['monthlyReports', month] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      showToast(`Échec du recalcul : ${message}`, 'warning');
    } finally {
      setIsGenerating(false);
    }
  }

  /* -------- Export Excel -------- */
  function handleExportExcel() {
    if (reports.length === 0) {
      showToast('Aucune donnée à exporter.', 'warning');
      return;
    }
    const label =
      monthOptions.find((o) => o.value === month)?.label ?? month;

    const wb = XLSX.utils.book_new();

    // ═══ Feuille Synthèse : heures + taux + coût RH + totaux ═══
    const synth: (string | number)[][] = [
      [`PROVENCE RUGBY — RAPPORT HORAIRES MENSUEL — ${label.toUpperCase()}`],
      [],
      ['Agent', 'Espace', 'Événements', 'H prévues', 'H réelles', 'H sup', 'Taux/h', 'Coût RH'],
    ];
    reports.forEach((r) => {
      const rate = rateFor(r);
      const cost = costFor(r);
      synth.push([
        r.staff_name,
        resolveSpaceName(r),
        r.total_events,
        `${(r.total_planned_h ?? 0).toFixed(1)}h`,
        `${(r.total_actual_h ?? 0).toFixed(1)}h`,
        `${(r.total_overtime_h ?? 0).toFixed(1)}h`,
        rate != null ? `${rate.toFixed(2)} €/h` : 'Non renseigné',
        cost != null ? `${cost.toFixed(2)} €` : '—',
      ]);
    });
    synth.push([]);
    synth.push([
      '',
      '',
      'TOTAUX',
      `${reports.reduce((s, r) => s + (r.total_planned_h ?? 0), 0).toFixed(1)}h`,
      `${reports.reduce((s, r) => s + (r.total_actual_h ?? 0), 0).toFixed(1)}h`,
      `${reports.reduce((s, r) => s + (r.total_overtime_h ?? 0), 0).toFixed(1)}h`,
      '',
      `${reports.reduce((s, r) => s + (costFor(r) ?? 0), 0).toFixed(2)} €`,
    ]);
    const wsSynth = XLSX.utils.aoa_to_sheet(synth);
    wsSynth['!cols'] = [
      { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSynth, 'Synthèse');

    // ═══ Feuille par agent : détail événement par événement ═══
    const usedNames = new Set<string>();
    reports.forEach((r) => {
      const detail = r.events_detail ?? [];
      const rate = rateFor(r);
      const aoa: (string | number)[][] = [
        [`Agent : ${r.staff_name} — ${resolveSpaceName(r)}`],
        [],
        ['Événement', 'Date', 'Espace', 'H prévues', 'H réelles', 'H sup', 'Taux/h', 'Coût RH'],
        ...detail.map((d): (string | number)[] => {
          const overtime = Math.max(0, (d.actual_h ?? 0) - (d.planned_h ?? 0));
          const cost = rate != null && d.actual_h != null ? d.actual_h * rate : null;
          return [
            d.event_name,
            formatDate(d.event_date),
            d.space_name,
            `${(d.planned_h ?? 0).toFixed(1)}h`,
            d.actual_h != null ? `${d.actual_h.toFixed(1)}h` : '—',
            `${overtime.toFixed(1)}h`,
            rate != null ? `${rate.toFixed(2)} €/h` : '—',
            cost != null ? `${cost.toFixed(2)} €` : '—',
          ];
        }),
      ];
      aoa.push([]);
      aoa.push([
        'TOTAL', '', '',
        `${(r.total_planned_h ?? 0).toFixed(1)}h`,
        `${(r.total_actual_h ?? 0).toFixed(1)}h`,
        `${(r.total_overtime_h ?? 0).toFixed(1)}h`,
        '',
        costFor(r) != null ? `${costFor(r)!.toFixed(2)} €` : '—',
      ]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 10 },
        { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(r.staff_name, usedNames));
    });

    // Nom fichier : Paie_2026-07_Juillet.xlsx
    const monthName = new Date(month).toLocaleDateString('fr-FR', { month: 'long' });
    const monthCap = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    XLSX.writeFile(wb, `Paie_${month.slice(0, 7)}_${monthCap}.xlsx`);
    showToast('Export paie généré.', 'success');
  }

  /* -------- Export PDF (impression navigateur) -------- */
  function handleExportPdf() {
    window.print();
  }

  /* ---------------------------------------------------------------- */
  /* Rendu                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div>
      <Link
        to="/admin/analytics/staff"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Staff &amp; Horaires
      </Link>

      <PageHeader
        title="Rapports horaires mensuels"
        description="Heures prévues / réelles / supplémentaires par agent — export comptabilité & RH."
      />

      {/* Filtres */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-52">
          <Select
            label="Mois"
            options={monthOptions}
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setExpandedId(null);
            }}
          />
        </div>
        <div className="w-52">
          <Select
            label="Espace"
            options={spaceOptions}
            value={spaceFilter}
            onChange={(e) => {
              setSpaceFilter(e.target.value);
              setExpandedId(null);
            }}
          />
        </div>
        <Button
          variant="secondary"
          onClick={handleGenerate}
          loading={isGenerating}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Générer / Recalculer
        </Button>
      </div>

      {reportsQuery.isError && (
        <Alert variant="error" title="Impossible de charger les rapports">
          {reportsQuery.error instanceof Error
            ? reportsQuery.error.message
            : 'Erreur inconnue.'}
        </Alert>
      )}

      {reportsQuery.isLoading ? (
        <Spinner fullPage label="Chargement des rapports…" />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aucun rapport pour ce mois"
          message="Cliquez sur « Générer » pour calculer les heures du mois sélectionné (événements clôturés/archivés uniquement)."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Agent</TH>
                <TH>Espace</TH>
                <TH className="text-right">Événements</TH>
                <TH className="text-right">H prévues</TH>
                <TH className="text-right">H réelles</TH>
                <TH className="text-right">H sup.</TH>
                <TH className="text-right">Taux/h</TH>
                <TH className="text-right">Coût RH</TH>
              </TR>
            </THead>
            <TBody>
              {reports.map((r) => {
                const overtime = r.total_overtime_h ?? 0;
                const isHigh = overtime > 5;
                const isExpanded = expandedId === r.id;
                const detail = r.events_detail ?? [];
                const rate = rateFor(r);
                const cost = costFor(r);
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : r.id)
                      }
                    >
                      <TD className="font-medium text-slate-900">
                        {r.staff_name}
                      </TD>
                      <TD>{resolveSpaceName(r)}</TD>
                      <TD className="text-right">{r.total_events}</TD>
                      <TD className="text-right">
                        {formatHours(r.total_planned_h)}
                      </TD>
                      <TD className="text-right">
                        {formatHours(r.total_actual_h)}
                      </TD>
                      <TD className="text-right">
                        <Badge tone={isHigh ? 'danger' : 'neutral'}>
                          +{overtime.toFixed(1)}h
                          {isHigh && ' ⚠️'}
                        </Badge>
                      </TD>
                      <TD className="text-right text-slate-500">
                        {rate != null ? `${rate.toFixed(2)} €/h` : '—'}
                      </TD>
                      <TD className="text-right font-medium">
                        {cost != null ? `${cost.toFixed(2)} €` : '—'}
                      </TD>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={8} className="px-3 py-3">
                          {detail.length === 0 ? (
                            <p className="text-sm text-slate-500">
                              Aucun événement détaillé pour cet agent.
                            </p>
                          ) : (
                            <Table>
                              <THead>
                                <TR>
                                  <TH>Événement</TH>
                                  <TH>Date</TH>
                                  <TH>Espace</TH>
                                  <TH className="text-right">H prévues</TH>
                                  <TH className="text-right">H réelles</TH>
                                  <TH className="text-center">Confirmé</TH>
                                </TR>
                              </THead>
                              <TBody>
                                {detail.map((d, idx) => (
                                  <TR key={`${r.id}-${idx}`}>
                                    <TD>{d.event_name}</TD>
                                    <TD>{formatDate(d.event_date)}</TD>
                                    <TD>{d.space_name}</TD>
                                    <TD className="text-right">
                                      {formatHours(d.planned_h)}
                                    </TD>
                                    <TD className="text-right">
                                      {formatHours(d.actual_h)}
                                    </TD>
                                    <TD className="text-center">
                                      {d.confirmed ? '✅' : '—'}
                                    </TD>
                                  </TR>
                                ))}
                              </TBody>
                            </Table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>

          {reports.some((r) => (r.total_overtime_h ?? 0) > 5) && (
            <Alert
              variant="warning"
              title="Heures supplémentaires élevées"
              className="mt-4"
            >
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Certains agents dépassent 5h supplémentaires ce mois-ci.
              </span>
            </Alert>
          )}

          {/* Actions d'export */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" onClick={handleExportExcel}>
              <Download className="h-4 w-4" aria-hidden />
              📥 Exporter Excel
            </Button>
            <Button variant="secondary" onClick={handleExportPdf}>
              <FileText className="h-4 w-4" aria-hidden />
              📄 Exporter PDF
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
