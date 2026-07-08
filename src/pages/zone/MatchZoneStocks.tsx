/**
 * MatchZoneStocks — saisie stock responsable de zone (flux token) en 3 étapes :
 *   1. Ouverture (stock initial)  2. Réassort  3. Clôture (stock final + état)
 * Regroupé par catégorie (CategoryGroups), RG-001 (nom), RG-004 (conso < 0
 * → commentaire obligatoire). Enregistre via save_zone_stock (SECURITY DEFINER).
 * Route : /zone/match/:sessionToken/stocks
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';
import { CategoryGroups, type CategoryItem } from '@/components/stock/CategoryGroups';

type Step = 'ouverture' | 'reassort' | 'cloture';

const STEPS: { key: Step; label: string; icon: string }[] = [
  { key: 'ouverture', label: 'Ouverture', icon: '📥' },
  { key: 'reassort', label: 'Réassort', icon: '🔄' },
  { key: 'cloture', label: 'Clôture', icon: '📤' },
];

const PRODUCT_STATES = ['fermé', 'ouvert', 'cassé', 'perdu', 'périmé', 'fût_vide', 'fût_percuté'] as const;

interface Line {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  planned_qty: number;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number | null;
  product_state: string | null;
  anomaly_comment?: string | null;
}

export default function MatchZoneStocks() {
  const { token, session, loading } = useMatchSession();
  const [nom, setNom] = useState('');
  const [step, setStep] = useState<Step>('ouverture');
  const [lines, setLines] = useState<Line[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!token || !session?.success) return;
    void supabase.rpc('get_zone_stock', { p_token: token }).then(({ data, error: err }) => {
      const r = data as { success?: boolean; lines?: Line[] } | null;
      if (err || !r?.success) return setReady(false);
      setLines((r.lines ?? []).map((l) => ({ ...l, anomaly_comment: l.anomaly_comment ?? '' })));
      setReady(true);
    });
  }, [token, session]);

  const patch = (id: string, upd: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.product_id === id ? { ...l, ...upd } : l)));

  const consumption = (l: Line): number | null =>
    l.final_qty == null ? null : l.initial_qty + l.reassort_qty - l.final_qty;

  const anomalies = useMemo(
    () => lines.filter((l) => step === 'cloture' && l.final_qty != null && (consumption(l) ?? 0) < 0 && !l.anomaly_comment?.trim()),
    [lines, step],
  );

  const items: CategoryItem<Line>[] = useMemo(
    () =>
      lines.map((l) => ({
        id: l.product_id,
        category: l.category,
        sortName: l.product_name,
        filled:
          step === 'ouverture' ? l.initial_qty > 0 : step === 'reassort' ? l.reassort_qty > 0 : l.final_qty != null,
        data: l,
      })),
    [lines, step],
  );

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-slate-500">Session expirée.</div>;

  async function save() {
    setError('');
    setSavedMsg('');
    if (nom.trim().length < 2) return setError('Indiquez votre nom (RG-001).');
    if (step === 'cloture' && anomalies.length > 0)
      return setError(`Consommation négative sur ${anomalies.length} produit(s) : ajoutez un commentaire d'anomalie (RG-004).`);
    setSaving(true);
    const payload = lines.map((l) => ({
      product_id: l.product_id,
      initial_qty: l.initial_qty,
      reassort_qty: l.reassort_qty,
      final_qty: l.final_qty,
      product_state: l.product_state ?? '',
      anomaly_comment: l.anomaly_comment ?? '',
    }));
    const { data, error: err } = await supabase.rpc('save_zone_stock', {
      p_token: token,
      p_step: step,
      p_responsable: nom,
      p_lines: payload,
    });
    setSaving(false);
    const r = data as { success?: boolean; error?: string } | null;
    if (err || !r?.success) return setError(r?.error ?? 'Enregistrement indisponible (applique zone_rpcs.sql).');
    setSavedMsg(`${STEPS.find((s) => s.key === step)?.label} enregistré ✅`);
  }

  function renderRow(l: Line) {
    const conso = consumption(l);
    const isAnomaly = step === 'cloture' && conso != null && conso < 0;
    return (
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{l.product_name}</p>
            <p className="text-xs text-slate-400">
              {l.unit}
              {step !== 'ouverture' && ` · init ${l.initial_qty}`}
              {step === 'cloture' && ` +réa ${l.reassort_qty}`}
              {step === 'ouverture' && l.planned_qty > 0 && ` · prévu ${l.planned_qty}`}
            </p>
          </div>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={
              step === 'ouverture'
                ? l.initial_qty || ''
                : step === 'reassort'
                  ? l.reassort_qty || ''
                  : l.final_qty ?? ''
            }
            onChange={(e) => {
              const v = e.target.value === '' ? (step === 'cloture' ? null : 0) : parseInt(e.target.value) || 0;
              if (step === 'ouverture') patch(l.product_id, { initial_qty: (v as number) ?? 0 });
              else if (step === 'reassort') patch(l.product_id, { reassort_qty: (v as number) ?? 0 });
              else patch(l.product_id, { final_qty: v as number | null });
            }}
            placeholder="0"
            className="h-12 w-24 shrink-0 rounded-lg border border-slate-200 text-center text-base font-semibold focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {step === 'cloture' && l.final_qty != null && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className={isAnomaly ? 'font-bold text-red-600' : 'text-slate-500'}>
                Consommé : {conso}
                {isAnomaly && ' ⚠️ anomalie'}
              </span>
              <select
                value={l.product_state ?? ''}
                onChange={(e) => patch(l.product_id, { product_state: e.target.value || null })}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              >
                <option value="">État…</option>
                {PRODUCT_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            {isAnomaly && (
              <input
                value={l.anomaly_comment ?? ''}
                onChange={(e) => patch(l.product_id, { anomaly_comment: e.target.value })}
                placeholder="Commentaire d'anomalie obligatoire (RG-004)"
                className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm focus:ring-2 focus:ring-red-400"
              />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        {/* Stepper */}
        <div className="grid grid-cols-3 gap-2">
          {STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setStep(s.key);
                setSavedMsg('');
                setError('');
              }}
              className={`rounded-xl border-2 py-3 text-center text-sm font-semibold transition-colors ${
                step === s.key ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              <span className="block text-lg">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="mb-2 block text-sm font-medium text-slate-700">Votre nom *</label>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value.toUpperCase())}
            placeholder="NOM Prénom"
            className="min-h-[48px] w-full rounded-lg border border-slate-200 px-3 py-3 text-base focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {ready === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fonctionnalité en cours d'activation — applique <code>supabase/zone_rpcs.sql</code>.
          </div>
        )}
        {ready && lines.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Aucun produit doté pour cet espace. Contactez l'équipe stade.
          </div>
        )}

        {lines.length > 0 && (
          <CategoryGroups
            items={items}
            renderItem={renderRow}
            totalLabel={(f, t) => `${f} / ${t} produits saisis`}
          />
        )}
      </div>

      {/* Barre d'action fixe */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-lg space-y-2">
            {error && <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-600">{error}</p>}
            {savedMsg && <p className="rounded-lg bg-green-50 p-2.5 text-sm text-green-700">{savedMsg}</p>}
            <button
              onClick={() => void save()}
              disabled={saving || nom.trim().length < 2}
              className="min-h-[56px] w-full rounded-xl bg-slate-900 py-4 text-base font-bold text-white disabled:opacity-40"
            >
              {saving ? 'Enregistrement…' : `Enregistrer — ${STEPS.find((s) => s.key === step)?.label}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
