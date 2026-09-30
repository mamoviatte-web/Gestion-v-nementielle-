/**
 * SpacesPage (ROLE_STADE) — maintenance des espaces : détection et résolution
 * des doublons (« Buvette 1 » alias de « B1 », deux « Salon Nord », …).
 *
 * Robustesse espaces : un responsable connecté sur un espace doublon doit voir
 * les données de l'espace CANONIQUE. Le motif « Buvette N → BN » est résolu
 * automatiquement côté serveur (zone_canonical_space) ; pour tout doublon à nom
 * libre, l'admin déclare ici la correspondance en un clic. Toute correspondance
 * ajoutée est prise en compte immédiatement par get_match_session / _zone_resolve
 * et les fonctions RH.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Trash2, AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Button, Select, Spinner, StatTile } from '@/components/ui';
import { downloadAoaWorkbook, type AoaCell, type AoaSheetOut } from '@/lib/xlsxAoa';
import { INT, type ColumnStyle } from '@/lib/excelTheme';

interface Space {
  space_id: string;
  space_name: string;
  space_type: string | null;
  access_code: string | null;
  capacity: number | null;
  max_pax: number | null;
  active: boolean;
  service_type: string | null;
  retains_stock: boolean | null;
  retain_kegs_in_espace: boolean | null;
}

/* Styles de colonnes Excel réutilisés (charte excelTheme). */
const colLeft: ColumnStyle = { align: 'left' };
const colCenter: ColumnStyle = { align: 'center' };
const colInt: ColumnStyle = { numFmt: INT, align: 'right' };

/** Ordre d'affichage stable des types d'espace (les autres suivent, triés). */
const TYPE_ORDER = ['VIP', 'Bar', 'Buvette'];
const typeRank = (t: string): number => {
  const i = TYPE_ORDER.indexOf(t);
  return i === -1 ? TYPE_ORDER.length : i;
};

/** Capacité effective d'un espace (capacity, sinon max_pax de service). */
const capacityOf = (s: Space): number | null => s.capacity ?? s.max_pax ?? null;
const yesNo = (v: boolean | null | undefined): string => (v ? 'Oui' : 'Non');
interface DuplicateRow {
  ghost_space_id: string;
  ghost_name: string;
  canonical_space_id: string;
  canonical_name: string;
  mapping_explicite: boolean;
}
interface MappingRow {
  ghost_space_id: string;
  canonical_space_id: string;
  created_at: string;
}

export default function SpacesPage() {
  const { showToast } = useToast();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [dups, setDups] = useState<DuplicateRow[]>([]);
  const [maps, setMaps] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ghostId, setGhostId] = useState('');
  const [canonId, setCanonId] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [sp, du, mp] = await Promise.all([
      supabase
        .from('spaces')
        .select(
          'space_id, space_name, space_type, access_code, capacity, max_pax, active, service_type, retains_stock, retain_kegs_in_espace',
        )
        .order('space_name'),
      supabase.from('space_duplicates_check').select('*'),
      supabase.from('space_canonical_map').select('ghost_space_id, canonical_space_id, created_at'),
    ]);
    setSpaces((sp.data as Space[] | null) ?? []);
    setDups((du.data as DuplicateRow[] | null) ?? []);
    setMaps((mp.data as MappingRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useMemo(() => {
    const m = new Map(spaces.map((s) => [s.space_id, s.space_name]));
    return (id: string) => m.get(id) ?? id;
  }, [spaces]);

  const spaceOptions = useMemo(
    () =>
      spaces.map((s) => ({
        value: s.space_id,
        label: `${s.space_name}${s.active ? '' : ' (inactif)'}`,
      })),
    [spaces],
  );

  /**
   * Synthèse du référentiel : espaces actifs, répartition par type (VIP/Bar/
   * Buvette), conservateurs de stock / de fûts, capacité totale. Base des KPIs
   * et des mini-barres.
   */
  const summary = useMemo(() => {
    const active = spaces.filter((s) => s.active);
    const byType = new Map<string, number>();
    let totalCapacity = 0;
    let retainsStock = 0;
    let retainsKegs = 0;
    for (const s of spaces) {
      const t = s.space_type ?? 'Non défini';
      byType.set(t, (byType.get(t) ?? 0) + 1);
      totalCapacity += capacityOf(s) ?? 0;
      if (s.retains_stock) retainsStock += 1;
      if (s.retain_kegs_in_espace) retainsKegs += 1;
    }
    const typeRows = [...byType.entries()]
      .map(([label, count]) => ({ key: label, label, count }))
      .sort((a, b) => b.count - a.count || typeRank(a.label) - typeRank(b.label));
    return {
      total: spaces.length,
      active: active.length,
      inactive: spaces.length - active.length,
      typeRows,
      totalCapacity,
      retainsStock,
      retainsKegs,
    };
  }, [spaces]);

  /** Export Excel complet et habillé du référentiel des espaces (charte excelTheme). */
  async function exportExcel() {
    setExporting(true);
    try {
      // ── Feuille SYNTHÈSE : compteurs globaux + répartition par type ──
      const total = summary.total;
      const synthAoa: AoaCell[][] = [
        ['Espaces — Provence Rugby · Stade Maurice-David'],
        [],
        ['Indicateur', 'Valeur'],
        ['Total espaces', total],
        ['Espaces actifs', summary.active],
        ['Espaces inactifs', summary.inactive],
        ['Conservent leur stock', summary.retainsStock],
        ['Conservent les fûts sur place', summary.retainsKegs],
        ['Capacité totale (pax)', summary.totalCapacity],
        [],
        ['Répartition par type', 'Nombre'],
        ...summary.typeRows.map((r): AoaCell[] => [r.label, r.count]),
        ['Total', total],
      ];

      // ── Feuille ESPACES : toutes les colonnes + ligne TOTAL / compteurs ──
      const header: AoaCell[] = [
        'Nom',
        'Type',
        "Code d'accès",
        'Capacité',
        'Conserve stock',
        'Conserve fûts',
        'Actif',
      ];
      const sorted = [...spaces].sort(
        (a, b) =>
          typeRank(a.space_type ?? '') - typeRank(b.space_type ?? '') ||
          (a.space_type ?? '').localeCompare(b.space_type ?? '') ||
          a.space_name.localeCompare(b.space_name),
      );
      const rows: AoaCell[][] = sorted.map((s) => [
        s.space_name,
        s.space_type ?? '—',
        s.access_code ?? '—',
        capacityOf(s) ?? '',
        yesNo(s.retains_stock),
        yesNo(s.retain_kegs_in_espace),
        yesNo(s.active),
      ]);
      const totalRow: AoaCell[] = [
        'Total',
        `${summary.typeRows.length} type(s)`,
        '',
        summary.totalCapacity,
        summary.retainsStock,
        summary.retainsKegs,
        `${summary.active} actif(s)`,
      ];

      const sheets: AoaSheetOut[] = [
        {
          name: 'Synthèse',
          aoa: synthAoa,
          widths: [30, 14],
          columns: [colLeft, colInt],
        },
        {
          name: 'Espaces',
          aoa: [['Référentiel des espaces — Provence Rugby'], [], header, ...rows, totalRow],
          widths: [26, 12, 14, 11, 15, 14, 9],
          columns: [colLeft, colLeft, colCenter, colInt, colCenter, colCenter, colCenter],
        },
      ];

      const dateStr = new Date().toISOString().slice(0, 10);
      await downloadAoaWorkbook(sheets, `Espaces_Provence-Rugby_${dateStr}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  async function declareMapping() {
    if (!ghostId || !canonId) return;
    if (ghostId === canonId) {
      showToast('Le doublon et le canonique doivent être différents.', 'warning');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('space_canonical_map')
      .upsert({ ghost_space_id: ghostId, canonical_space_id: canonId }, { onConflict: 'ghost_space_id' });
    setSaving(false);
    if (error) {
      showToast(`Échec : ${error.message}`, 'warning');
      return;
    }
    showToast(`« ${nameOf(ghostId)} » rattaché à « ${nameOf(canonId)} ».`, 'success');
    setGhostId('');
    setCanonId('');
    void load();
  }

  async function removeMapping(ghost: string) {
    const { error } = await supabase.from('space_canonical_map').delete().eq('ghost_space_id', ghost);
    if (error) {
      showToast(`Échec : ${error.message}`, 'warning');
      return;
    }
    showToast('Correspondance supprimée.', 'success');
    void load();
  }

  if (loading) return <Spinner />;

  const unmapped = dups.filter((d) => !d.mapping_explicite);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Espaces en double"
        description="Détection et résolution des doublons. Un responsable connecté sur un doublon voit toujours les données de l'espace canonique."
        action={
          <Button
            size="sm"
            variant="secondary"
            disabled={spaces.length === 0 || exporting}
            onClick={() => void exportExcel()}
          >
            <Download className="h-4 w-4" /> {exporting ? 'Génération…' : 'Exporter Excel'}
          </Button>
        }
      />

      {/* Bande de synthèse (KPIs + mini-barres par type) — vue d'ensemble du référentiel. */}
      {spaces.length > 0 && (
        <div className="mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="Espaces actifs"
              value={summary.active}
              tone="good"
              sub={`${summary.total} au total · ${summary.inactive} inactif(s)`}
            />
            <StatTile
              label="Types"
              value={summary.typeRows.length}
              sub={summary.typeRows.map((r) => `${r.label} ${r.count}`).join(' · ') || '—'}
            />
            <StatTile
              label="Conservent le stock"
              value={summary.retainsStock}
              sub={`${summary.total - summary.retainsStock} remis au dépôt`}
            />
            <StatTile
              label="Conservent les fûts"
              value={summary.retainsKegs}
              sub="fûts stockés sur place"
            />
            <StatTile
              label="Capacité totale"
              value={summary.totalCapacity.toLocaleString('fr-FR')}
              sub="pax cumulés"
            />
          </div>
          <TypeBreakdown items={summary.typeRows} total={summary.total} />
        </div>
      )}

      {/* Doublons détectés par motif (Buvette N ↔ BN) */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-pr-black-soft/50">
          Doublons détectés (motif automatique)
        </h2>
        {dups.length === 0 ? (
          <Alert variant="success">Aucun doublon de motif « Buvette N » détecté.</Alert>
        ) : (
          <div className="overflow-hidden rounded-xl border border-pr-stone">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pr-stone bg-pr-cream text-left text-xs uppercase tracking-wide text-pr-black-soft/45">
                  <th className="px-4 py-2">Doublon</th>
                  <th className="px-4 py-2">→ Canonique</th>
                  <th className="px-4 py-2 text-right">État</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pr-stone/60">
                {dups.map((d) => (
                  <tr key={d.ghost_space_id} className="text-pr-black-soft/90">
                    <td className="px-4 py-2 font-medium">{d.ghost_name}</td>
                    <td className="px-4 py-2">{d.canonical_name}</td>
                    <td className="px-4 py-2 text-right">
                      {d.mapping_explicite ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 size={14} /> Lié
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle size={14} /> Auto (motif)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unmapped.length > 0 && (
          <p className="mt-2 text-xs text-pr-black-soft/50">
            Les doublons « Auto (motif) » sont déjà résolus côté serveur ; les déclarer explicitement ci-dessous
            les fige durablement (utile si le nom devait changer).
          </p>
        )}
      </section>

      {/* Déclaration manuelle (noms libres) */}
      <section className="mb-8 rounded-xl border border-pr-stone bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-pr-black-soft/90">Déclarer une correspondance</h2>
        <p className="mb-4 text-xs text-pr-black-soft/50">
          Pour tout doublon à nom libre (deux « Salon Nord », un « Wine bar Nord » dupliqué…), choisissez l'espace
          doublon puis son espace canonique. Prise en compte immédiate partout.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-pr-black-soft/70">Espace doublon</label>
            <Select
              value={ghostId}
              onChange={(e) => setGhostId(e.target.value)}
              options={[{ value: '', label: '— choisir —' }, ...spaceOptions]}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-pr-black-soft/70">Espace canonique</label>
            <Select
              value={canonId}
              onChange={(e) => setCanonId(e.target.value)}
              options={[{ value: '', label: '— choisir —' }, ...spaceOptions]}
            />
          </div>
          <Button onClick={() => void declareMapping()} disabled={saving || !ghostId || !canonId}>
            <Link2 size={16} /> Rattacher
          </Button>
        </div>
      </section>

      {/* Correspondances explicites existantes */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-pr-black-soft/50">
          Correspondances explicites ({maps.length})
        </h2>
        {maps.length === 0 ? (
          <p className="text-sm text-pr-black-soft/45">Aucune correspondance déclarée manuellement.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-pr-stone">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pr-stone bg-pr-cream text-left text-xs uppercase tracking-wide text-pr-black-soft/45">
                  <th className="px-4 py-2">Doublon</th>
                  <th className="px-4 py-2">→ Canonique</th>
                  <th className="px-4 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pr-stone/60">
                {maps.map((m) => (
                  <tr key={m.ghost_space_id} className="text-pr-black-soft/90">
                    <td className="px-4 py-2 font-medium">{nameOf(m.ghost_space_id)}</td>
                    <td className="px-4 py-2">{nameOf(m.canonical_space_id)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => void removeMapping(m.ghost_space_id)}
                        className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800"
                      >
                        <Trash2 size={14} /> Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Mini-graphe : barres horizontales du nombre d'espaces par type (tri décroissant). */
function TypeBreakdown({
  items,
  total,
}: {
  items: { key: string; label: string; count: number }[];
  total: number;
}) {
  const visible = items.filter((i) => i.count > 0);
  const max = Math.max(1, ...visible.map((i) => i.count));
  return (
    <div className="overflow-hidden rounded-2xl border border-pr-stone bg-white">
      <div className="border-b border-pr-stone bg-pr-cream px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-pr-black-soft/50">
        Répartition par type
      </div>
      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-pr-black-soft/40">Aucune donnée.</p>
      ) : (
        <div className="divide-y divide-pr-stone/50">
          {visible.map((r) => (
            <div key={r.key} className="px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-pr-black-soft/80">{r.label}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-pr-olive-dark">
                  {r.count}
                  <span className="ml-1 text-[11px] font-normal text-pr-black-soft/40">
                    {total > 0 ? `${Math.round((r.count / total) * 100)} %` : ''}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-pr-stone/50">
                <div className="h-full rounded-full bg-pr-olive" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
