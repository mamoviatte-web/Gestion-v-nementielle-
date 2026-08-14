/**
 * BuvetteDetailPage — process complet d'UNE buvette membre (flux token
 * superviseur) : STOCK (Ouverture / Réassort / Clôture) + DÉBRIEF.
 *   • Stock : FamilyStockForm → save_zone_buvette_stock(p_target_space).
 *   • Débrief : BuvetteDebriefForm → save_zone_buvette_debrief(p_target_space).
 * Route : …/buvette/:spaceId   (code de la buvette passé via router state).
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';
import { FamilyStockForm, type StockLine, type StockMode } from '@/components/stock/FamilyStockForm';
import { BuvetteDebriefForm } from '@/components/zone/BuvetteDebriefForm';

type Step = 'ouverture' | 'reassort' | 'cloture' | 'debrief';
const STOCK_STEPS: { key: Exclude<Step, 'debrief'>; label: string; icon: string; mode: StockMode }[] = [
  { key: 'ouverture', label: 'Ouverture', icon: '📥', mode: 'initial' },
  { key: 'reassort', label: 'Réassort', icon: '🔄', mode: 'reassort' },
  { key: 'cloture', label: 'Clôture', icon: '📤', mode: 'final' },
];
const TABS: { key: Step; label: string; icon: string }[] = [
  ...STOCK_STEPS.map((s) => ({ key: s.key as Step, label: s.label, icon: s.icon })),
  { key: 'debrief', label: 'Débrief', icon: '📝' },
];

interface Line extends StockLine {
  planned_qty: number;
}

export default function BuvetteDetailPage() {
  const { token, session, loading } = useMatchSession();
  const { spaceId } = useParams<{ spaceId: string }>();
  const { state } = useLocation() as { state?: { code?: string } };
  const code = state?.code;
  const [nom, setNom] = useState('');
  const [step, setStep] = useState<Step>('ouverture');
  const [lines, setLines] = useState<Line[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!token || !session?.success || !spaceId) return;
    void supabase.rpc('get_zone_buvette_stock', { p_token: token, p_target_space: spaceId }).then(({ data, error: err }) => {
      const r = data as { success?: boolean; lines?: Line[]; error?: string } | null;
      if (err || !r?.success) return setReady(false);
      setLines((r.lines ?? []).map((l) => ({ ...l, anomaly_comment: l.anomaly_comment ?? '' })));
      setReady(true);
    });
  }, [token, session, spaceId]);

  const patch = (id: string, upd: Partial<Line>) => setLines((prev) => prev.map((l) => (l.product_id === id ? { ...l, ...upd } : l)));
  const onFieldChange = (id: string, field: keyof StockLine, value: number | string | null) => patch(id, { [field]: value } as Partial<Line>);

  const isDebrief = step === 'debrief';
  const mode: StockMode = STOCK_STEPS.find((s) => s.key === step)?.mode ?? 'initial';
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
    setSaving(true);
    const payload = lines.map((l) => ({
      product_id: l.product_id,
      initial_qty: l.initial_qty,
      reassort_qty: l.reassort_qty,
      final_qty: l.final_qty,
    }));
    const { data, error: err } = await supabase.rpc('save_zone_buvette_stock', {
      p_token: token,
      p_step: step,
      p_responsable: nom,
      p_lines: payload,
      p_target_space: spaceId,
    });
    setSaving(false);
    const r = data as { success?: boolean; error?: string } | null;
    if (err || !r?.success) return setError(r?.error ?? 'Enregistrement indisponible.');
    setSavedMsg(`${STOCK_STEPS.find((s) => s.key === step)?.label} enregistré ✅`);
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        {code && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-lg text-white">🍺</span>
            <p className="font-bold text-slate-900">{code}</p>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          {TABS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setStep(s.key);
                setSavedMsg('');
                setError('');
              }}
              className={`rounded-xl border-2 py-3 text-center text-xs font-semibold transition-colors ${step === s.key ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'}`}
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

        {isDebrief ? (
          <BuvetteDebriefForm token={token!} spaceId={spaceId!} responsable={nom} code={code} />
        ) : (
          <>
            {ready === false && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Fonctionnalité en cours d'activation — applique <code>supabase/buvette_supervisor.sql</code>.
              </div>
            )}
            {mode === 'final' && visibleLines.length === 0 && ready && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
                Aucun produit à saisir — complétez d'abord l'ouverture (stock initial).
              </div>
            )}
            {visibleLines.length > 0 && <FamilyStockForm lines={visibleLines} mode={mode} onChange={onFieldChange} spaceType="buvette" />}
          </>
        )}
      </div>

      {!isDebrief && visibleLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-lg space-y-2">
            {error && <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-600">{error}</p>}
            {savedMsg && <p className="rounded-lg bg-green-50 p-2.5 text-sm text-green-700">{savedMsg}</p>}
            <button
              onClick={() => void save()}
              disabled={saving || nom.trim().length < 2}
              className="min-h-[56px] w-full rounded-xl bg-slate-900 py-4 text-base font-bold text-white disabled:opacity-40"
            >
              {saving ? 'Enregistrement…' : `Enregistrer — ${STOCK_STEPS.find((s) => s.key === step)?.label}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
