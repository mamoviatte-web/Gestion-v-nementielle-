/**
 * PeriodSelector — filtre temporel (mois / année / tout / personnalisé) avec
 * navigation précédent/suivant. `buildPeriod` est exporté pour l'état initial.
 */

import { useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

export type PeriodMode = 'mois' | 'annee' | 'personnalise' | 'tout';

export interface Period {
  mode: PeriodMode;
  startDate: Date;
  endDate: Date;
  label: string;
}

export function buildPeriod(mode: PeriodMode, offset = 0, customStart?: Date, customEnd?: Date): Period {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (mode) {
    case 'mois': {
      const d = new Date(year, month + offset, 1);
      return {
        mode,
        startDate: new Date(d.getFullYear(), d.getMonth(), 1),
        endDate: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
        label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      };
    }
    case 'annee': {
      const y = year + offset;
      return { mode, startDate: new Date(y, 0, 1), endDate: new Date(y, 11, 31, 23, 59, 59), label: String(y) };
    }
    case 'personnalise': {
      const start = customStart ?? new Date(year, month, 1);
      const end = customEnd ?? new Date(year, month + 1, 0);
      return {
        mode,
        startDate: start,
        endDate: end,
        label: `${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} → ${end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      };
    }
    case 'tout':
    default:
      return { mode: 'tout', startDate: new Date(2020, 0, 1), endDate: new Date(2099, 11, 31), label: "Tout l'historique" };
  }
}

const MODES: { key: PeriodMode; label: string; icon: string }[] = [
  { key: 'mois', label: 'Mois', icon: '📅' },
  { key: 'annee', label: 'Année', icon: '📆' },
  { key: 'tout', label: 'Tout', icon: '🗂' },
  { key: 'personnalise', label: 'Personnalisé', icon: '✏️' },
];

export function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [offset, setOffset] = useState(0);
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  function handleModeChange(mode: PeriodMode) {
    if (mode === 'personnalise') {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    setOffset(0);
    onChange(buildPeriod(mode));
  }

  function navigate(dir: -1 | 1) {
    const newOffset = offset + dir;
    setOffset(newOffset);
    onChange(buildPeriod(value.mode, newOffset));
  }

  function applyCustom() {
    if (!customStart || !customEnd) return;
    onChange(buildPeriod('personnalise', 0, new Date(customStart), new Date(customEnd)));
    setShowCustom(false);
  }

  const navigable = value.mode === 'mois' || value.mode === 'annee';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-stone-200 bg-white text-sm shadow-sm">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => handleModeChange(m.key)}
              className={`flex items-center gap-1 px-3 py-2 font-semibold transition-colors ${value.mode === m.key ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'}`}
            >
              <span className="text-base">{m.icon}</span>
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </div>

        {navigable ? (
          <div className="flex items-center gap-1 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            <button onClick={() => navigate(-1)} className="border-r border-stone-200 px-2.5 py-2 text-stone-600 hover:bg-stone-50">
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[140px] px-4 py-2 text-center text-sm font-bold capitalize text-stone-800">{value.label}</span>
            <button onClick={() => navigate(1)} disabled={offset >= 0} className="border-l border-stone-200 px-2.5 py-2 text-stone-600 hover:bg-stone-50 disabled:opacity-30">
              <ChevronRight size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm text-stone-700 shadow-sm">
            <Calendar size={14} className="text-stone-400" />
            <span className="font-semibold">{value.label}</span>
          </div>
        )}
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-sm font-semibold text-amber-800">Du</span>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <span className="text-sm font-semibold text-amber-800">au</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <button onClick={applyCustom} disabled={!customStart || !customEnd} className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40">Appliquer</button>
          <button onClick={() => setShowCustom(false)} className="text-xs text-amber-600 underline">Annuler</button>
        </div>
      )}
    </div>
  );
}
