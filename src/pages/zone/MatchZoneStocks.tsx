/**
 * MatchZoneStocks — saisie stock responsable de zone (flux token) en 3 étapes :
 *   1. Ouverture (stock initial)  2. Réassort  3. Clôture (stock final + état)
 * Regroupé par catégorie (FamilyStockForm), RG-001 (nom), RG-004 (conso < 0
 * → rappel commentaire, non bloquant).
 *
 * ENREGISTREMENT AUTOMATIQUE : chaque chiffre saisi est persisté (debounce
 * ~700 ms) via save_zone_stock (upsert idempotent par étape). Plus rien ne
 * disparaît en changeant d'étape, en ajoutant une ligne ou en revenant plus
 * tard : les valeurs sont rechargées depuis la base (get_zone_stock). Le nom
 * est mémorisé sur l'appareil pour éviter de le re-saisir.
 * Route : /zone/match/:sessionToken/stocks
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';
import { FamilyStockForm, type StockLine, type StockMode } from '@/components/stock/FamilyStockForm';

type Step = 'ouverture' | 'reassort' | 'cloture';
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const STEPS: { key: Step; label: string; icon: string; mode: StockMode }[] = [
  { key: 'ouverture', label: 'Ouverture', icon: '📥', mode: 'initial' },
  { key: 'reassort', label: 'Réassort', icon: '🔄', mode: 'reassort' },
  { key: 'cloture', label: 'Clôture', icon: '📤', mode: 'final' },
];

const NOM_KEY = 'zone_responsable_nom';

interface Line extends StockLine {
  planned_qty: number;
}

export default function MatchZoneStocks() {
  const { token, session, loading } = useMatchSession();
  const [nom, setNom] = useState('');
  const [step, setStep] = useState<Step>('ouverture');
  const [lines, setLines] = useState<Line[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [spaceProfile, setSpaceProfile] = useState<string | undefined>(undefined);

  // État d'enregistrement automatique
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState('');
  const [saveErr, setSaveErr] = useState('');

  // Refs pour l'auto-save débouncé (évite les closures périmées)
  const linesRef = useRef(lines); linesRef.current = lines;
  const nomRef = useRef(nom); nomRef.current = nom;
  const stepRef = useRef(step); stepRef.current = step;
  const tokenRef = useRef(token); tokenRef.current = token;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nom mémorisé sur l'appareil (moins de friction)
  useEffect(() => {
    try { const saved = localStorage.getItem(NOM_KEY); if (saved) setNom(saved); } catch { /* stockage indispo */ }
  }, []);

  useEffect(() => {
    if (!token || !session?.success) return;
    void supabase.rpc('get_zone_stock', { p_token: token }).then(({ data, error: err }) => {
      const r = data as { success?: boolean; lines?: Line[]; space_profile?: string } | null;
      if (err || !r?.success) return setReady(false);
      setLines((r.lines ?? []).map((l) => ({ ...l, anomaly_comment: l.anomaly_comment ?? '' })));
      setSpaceProfile(r.space_profile);
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

  // ── Enregistrement (persistance réelle) ────────────────────────────────
  async function persist() {
    const nm = nomRef.current.trim();
    const tk = tokenRef.current;
    if (nm.length < 2 || !tk) { setSaveState('idle'); return; }
    const st = stepRef.current;
    setSaveState('saving');
    setSaveErr('');
    const payload = linesRef.current.map((l) => ({
      product_id: l.product_id,
      initial_qty: l.initial_qty,
      reassort_qty: l.reassort_qty,
      final_qty: l.final_qty,
      product_state: 'fermé',
      anomaly_comment: l.anomaly_comment ?? '',
    }));
    const { data, error: err } = await supabase.rpc('save_zone_stock', {
      p_token: tk, p_step: st, p_responsable: nm, p_lines: payload,
    });
    const r = data as { success?: boolean; error?: string } | null;
    if (err || !r?.success) {
      setSaveState('error');
      setSaveErr(r?.error ?? 'Enregistrement indisponible.');
      return;
    }
    setSaveState('saved');
    setSavedAt(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  }

  // Auto-save débouncé sur chaque saisie
  function scheduleSave() {
    if (nomRef.current.trim().length < 2 || linesRef.current.length === 0) { setSaveState('idle'); return; }
    setSaveState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(); }, 700);
  }
  function flushSave() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    void persist();
  }

  const onFieldChange = (id: string, field: keyof StockLine, value: number | string | null) => {
    patch(id, { [field]: value } as Partial<Line>);
    scheduleSave();
  };

  // Quand le nom passe valide (ou change), mémoriser + persister les saisies déjà faites.
  useEffect(() => {
    if (nom.trim().length >= 2) {
      try { localStorage.setItem(NOM_KEY, nom); } catch { /* stockage indispo */ }
      scheduleSave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nom]);

  // Flush à la sortie (changement de page dans l'app) pour ne rien perdre.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void persist(); } }, []);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-pr-cream text-pr-black-soft/50">Chargement…</div>;
  if (!session?.success) return <div className="p-8 text-center text-pr-black-soft/50">Session expirée.</div>;

  const nomValid = nom.trim().length >= 2;

  return (
    <div className="min-h-screen bg-pr-cream pb-28">
      <MatchZoneHeader session={session} back />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        {/* Stepper — flush avant de changer d'étape */}
        <div className="grid grid-cols-3 gap-2">
          {STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => { flushSave(); setStep(s.key); }}
              className={`rounded-xl border-2 py-3 text-center text-sm font-semibold transition-colors ${
                step === s.key ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-pr-stone bg-white text-pr-black-soft/50'
              }`}
            >
              <span className="block text-lg">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-pr-stone bg-white p-4">
          <label className="mb-2 block text-sm font-medium text-pr-black-soft/80">Votre nom *</label>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value.toUpperCase())}
            placeholder="NOM Prénom"
            className="min-h-[48px] w-full rounded-lg border border-pr-stone px-3 py-3 text-base focus:ring-2 focus:ring-amber-400"
          />
          {!nomValid && <p className="mt-2 text-xs text-amber-700">Indiquez votre nom pour activer l'enregistrement automatique (RG-001).</p>}
        </div>

        {ready === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Fonctionnalité en cours d'activation — applique <code>supabase/zone_rpcs.sql</code>.
          </div>
        )}
        {ready && lines.length === 0 && (
          <div className="rounded-xl border border-pr-stone bg-white p-6 text-center text-sm text-pr-black-soft/50">
            Aucun produit actif pour cet espace. Contactez l'équipe stade.
          </div>
        )}

        {/* Clôture : bandeau récap + garde-fou si l'ouverture n'a pas été saisie */}
        {mode === 'final' && lines.length > 0 && visibleLines.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-pr-stone bg-pr-cream px-4 py-3 text-sm text-pr-black-soft/70">
            <span>📋</span>
            <span>
              <strong>{visibleLines.length} produit(s)</strong> à saisir — uniquement ceux déclarés à l'ouverture ou au réassort.
            </span>
          </div>
        )}
        {mode === 'final' && lines.length > 0 && visibleLines.length === 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
            Aucun produit à saisir — complétez d'abord l'ouverture (stock initial).
          </div>
        )}

        {visibleLines.length > 0 && <FamilyStockForm lines={visibleLines} mode={mode} onChange={onFieldChange} spaceType={spaceProfile} />}
      </div>

      {/* Barre d'état fixe — enregistrement automatique */}
      {visibleLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-pr-stone bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-sm">
              {!nomValid ? (
                <span className="text-amber-700">✍️ Entrez votre nom — l'enregistrement se fait ensuite tout seul.</span>
              ) : saveState === 'error' ? (
                <span className="text-red-600">⚠️ {saveErr}</span>
              ) : saveState === 'saving' || saveState === 'pending' ? (
                <span className="text-pr-black-soft/50">💾 Enregistrement…</span>
              ) : saveState === 'saved' ? (
                <span className="font-medium text-green-700">✓ Enregistré automatiquement{savedAt ? ` · ${savedAt}` : ''}</span>
              ) : (
                <span className="text-pr-black-soft/45">Chaque chiffre est enregistré automatiquement.</span>
              )}
              {mode === 'final' && anomalies.length > 0 && (
                <p className="mt-0.5 text-xs text-amber-700">
                  ⚠️ Conso négative sur {anomalies.slice(0, 2).map((l) => l.product_name).join(', ')}
                  {anomalies.length > 2 ? `… (+${anomalies.length - 2})` : ''} — ajoutez un commentaire d'anomalie (RG-004).
                </p>
              )}
            </div>
            <button
              onClick={() => flushSave()}
              disabled={!nomValid || saveState === 'saving'}
              className="min-h-[48px] shrink-0 rounded-xl border border-pr-stone bg-white px-4 py-2 text-sm font-semibold text-pr-black-soft/80 disabled:opacity-40"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
