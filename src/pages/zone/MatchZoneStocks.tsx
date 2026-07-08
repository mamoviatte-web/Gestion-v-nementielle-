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
import { FamilyStockForm, type StockLine, type StockMode } from '@/components/stock/FamilyStockForm';

type Step = 'ouverture' | 'reassort' | 'cloture';

const STEPS: { key: Step; label: string; icon: string; mode: StockMode }[] = [
  { key: 'ouverture', label: 'Ouverture', icon: '📥', mode: 'initial' },
  { key: 'reassort', label: 'Réassort', icon: '🔄', mode: 'reassort' },
  { key: 'cloture', label: 'Clôture', icon: '📤', mode: 'final' },
];

interface Line extends StockLine {
  planned_qty: number;
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

  const mode: StockMode = STEPS.find((s) => s.key === step)!.mode;

  // Clôture : uniquement les produits ayant eu un mouvement (initial ou réassort).
  const visibleLines = useMemo(
    () => (mode === 'final' ? lines.filter((l) => l.initial_qty > 0 || l.reassort_qty > 0) : lines),
    [lines, mode],
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

  const onFieldChange = (id: string, field: keyof StockLine, value: number | string | null) =>
    patch(id, { [field]: value } as Partial<Line>);

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
            Aucun produit actif pour cet espace. Contactez l'équipe stade.
          </div>
        )}

        {lines.length > 0 && <FamilyStockForm lines={visibleLines} mode={mode} onChange={onFieldChange} />}
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
