/**
 * ReserveReconcilePage — Réserve : divergence ledger/solde & réconciliation.
 * Affiche reserve_stock_divergence() (solde stocké vs solde impliqué par le
 * grand livre des mouvements, écart, négatifs en tête) et permet de RECALER un
 * produit sur un comptage physique via reconcile_reserve_count (qui pose le
 * solde ET émet le mouvement 'inventaire' tracé → ledger = solde). RG-001 :
 * nom du responsable du comptage obligatoire.
 */

import { useCallback, useEffect, useState } from 'react';
import { Boxes, RefreshCw, Check, X, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Badge, Button, Card, EmptyState, Input, SectionTitle, Spinner, StatTile } from '@/components/ui';
import { StockHealthPanel } from '@/components/stock/StockHealthPanel';

interface Row {
  reserve_id: string;
  reserve_name: string;
  product_id: string;
  product_name: string;
  category: string;
  stored: number;
  ledger_implied: number;
  ecart: number;
  negatif: boolean;
}

export default function ReserveReconcilePage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [operator, setOperator] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [countValue, setCountValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('reserve_stock_divergence');
    setRows(((data as Row[] | null) ?? []).map((r) => ({
      ...r,
      stored: Number(r.stored), ledger_implied: Number(r.ledger_implied), ecart: Number(r.ecart),
    })));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function startEdit(r: Row) {
    setEditing(r.product_id + r.reserve_id);
    setCountValue(String(Math.max(0, Math.round(r.stored))));
  }

  async function submitCount(r: Row) {
    const qty = Number(countValue);
    if (!Number.isFinite(qty) || qty < 0) { showToast('Quantité comptée invalide.', 'warning'); return; }
    if (operator.trim().length < 2) { showToast('Renseigne le nom du responsable du comptage (RG-001).', 'warning'); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc('reconcile_reserve_count', {
      p_product_id: r.product_id, p_counted_qty: qty, p_by: operator.trim(),
      p_reason: 'Comptage physique réserve', p_reserve_id: r.reserve_id,
    });
    const res = data as { success?: boolean; error?: string; delta?: number } | null;
    setSaving(false);
    if (error || !res?.success) { showToast(`Échec : ${res?.error ?? error?.message ?? 'recalage impossible'}`, 'warning'); return; }
    showToast(`${r.product_name} recalé à ${qty} (delta ${res.delta ?? 0}).`, 'success');
    setEditing(null);
    await load();
  }

  if (loading) return <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6"><Card><Spinner label="Analyse des réserves…" /></Card></div>;

  const negatifs = rows.filter((r) => r.negatif).length;
  const ecartTotal = rows.reduce((s, r) => s + Math.abs(r.ecart), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <StockHealthPanel />
      <Card accent={negatifs > 0 ? 'rust' : 'olive'}>
        <SectionTitle
          icon={Boxes}
          right={
            <button onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-pr-black-soft/45 hover:text-pr-black-soft/70">
              <RefreshCw size={12} /> Rafraîchir
            </button>
          }
        >
          Réserve — divergence &amp; réconciliation
        </SectionTitle>

        <p className="mb-3 text-xs text-pr-black-soft/55">
          Le solde stocké est piloté par les comptages physiques ; le « ledger » est le solde impliqué par le grand livre des mouvements.
          Un écart signale une désynchronisation ; un solde <b>négatif</b> est physiquement impossible. Recaler sur un comptage réaligne les deux (mouvement d'inventaire tracé).
        </p>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile label="Produits en écart" value={rows.length} />
          <StatTile label="Soldes négatifs" value={negatifs} tone={negatifs > 0 ? 'crit' : 'good'} />
          <StatTile label="Écart absolu cumulé" value={Math.round(ecartTotal)} sub="unités" />
        </div>

        <div className="mb-3 max-w-sm">
          <Input
            label="Responsable du comptage (RG-001)"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="Nom du responsable"
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Réserves alignées" message="Aucun écart entre le solde stocké et le grand livre." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-pr-stone">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pr-stone bg-pr-cream text-left text-[11px] uppercase tracking-wider text-pr-black-soft/45">
                  <th className="px-3 py-2">Produit</th>
                  <th className="px-3 py-2">Réserve</th>
                  <th className="px-3 py-2 text-right">Stocké</th>
                  <th className="px-3 py-2 text-right">Ledger</th>
                  <th className="px-3 py-2 text-right">Écart</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pr-stone/50">
                {rows.map((r) => {
                  const key = r.product_id + r.reserve_id;
                  const isEditing = editing === key;
                  return (
                    <tr key={key} className={r.negatif ? 'bg-pr-rust/5' : undefined}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-pr-black">{r.product_name}</span>
                        {r.negatif && <Badge tone="danger" className="ml-2">négatif</Badge>}
                        <span className="ml-2 text-xs text-pr-black-soft/40">{r.category}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-pr-black-soft/60">{r.reserve_name}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.negatif ? 'font-bold text-pr-rust' : 'text-pr-black'}`}>{r.stored}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-pr-black-soft/50">{r.ledger_implied}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-pr-black-soft/70">{r.ecart > 0 ? `+${r.ecart}` : r.ecart}</td>
                      <td className="px-3 py-2 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number" min={0} value={countValue}
                              onChange={(e) => setCountValue(e.target.value)}
                              className="w-20 rounded-lg border border-pr-stone bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-pr-olive focus:outline-none focus:ring-2 focus:ring-pr-olive/20"
                              autoFocus
                            />
                            <button onClick={() => void submitCount(r)} disabled={saving}
                              className="rounded-lg bg-pr-olive p-1.5 text-white hover:bg-pr-olive-dark disabled:opacity-50" title="Valider le comptage">
                              <Check size={14} />
                            </button>
                            <button onClick={() => setEditing(null)}
                              className="rounded-lg border border-pr-stone p-1.5 text-pr-black-soft/50 hover:bg-pr-stone/40" title="Annuler">
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => startEdit(r)}>Recaler</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {negatifs > 0 && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-pr-rust/30 bg-pr-rust/5 px-3 py-2 text-xs font-medium text-pr-black-soft/80">
            <AlertTriangle size={14} className="text-pr-rust" /> {negatifs} solde(s) négatif(s) — recaler d'urgence sur un comptage physique (un stock ne peut être négatif).
          </p>
        )}
      </Card>
    </div>
  );
}
