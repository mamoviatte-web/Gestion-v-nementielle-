/**
 * FamilyStockForm — saisie stock par famille dépliable (mobile-first).
 * Sans dropdown état sur ouverture / réassort ; état conservé en clôture,
 * uniquement si la quantité finale > 0. Aide-mémoire de consommation et
 * alerte RG-004 (stock final > stock entré) avec commentaire d'anomalie.
 */

import { useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FAMILIES: { key: string; label: string; emoji: string; color: string }[] = [
  { key: 'Bières', label: 'Bières & Fûts', emoji: '🍺', color: 'bg-yellow-50' },
  { key: 'Vins', label: 'Vins', emoji: '🍷', color: 'bg-purple-50' },
  { key: 'Soft', label: 'Softs', emoji: '🥤', color: 'bg-blue-50' },
  { key: 'Sirops', label: 'Sirops', emoji: '🫙', color: 'bg-pink-50' },
  { key: 'Spiritueux', label: 'Spiritueux', emoji: '🥃', color: 'bg-orange-50' },
  { key: 'Matériel', label: 'Matériel & Linge', emoji: '📦', color: 'bg-stone-50' },
];
const FAMILY_ORDER = FAMILIES.map((f) => f.key);

const PRODUCT_STATES = [
  { value: 'fermé', label: 'Fermé (intact)' },
  { value: 'ouvert', label: 'Ouvert (entamé)' },
  { value: 'cassé', label: 'Cassé' },
  { value: 'perdu', label: 'Perdu' },
  { value: 'périmé', label: 'Périmé' },
  { value: 'fût_vide', label: 'Fût vide' },
  { value: 'fût_percuté', label: 'Fût percuté' },
];

export interface StockLine {
  product_id: string;
  product_name: string;
  category: string;
  unit: string;
  initial_qty: number;
  reassort_qty: number;
  final_qty: number | null;
  product_state: string | null;
  anomaly_comment?: string | null;
}

export type StockMode = 'initial' | 'reassort' | 'final';

interface Props {
  lines: StockLine[];
  mode: StockMode;
  onChange: (productId: string, field: keyof StockLine, value: number | string | null) => void;
}

export function FamilyStockForm({ lines, mode, onChange }: Props) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const byFamily = useMemo(() => {
    const map: Record<string, StockLine[]> = {};
    for (const line of lines) (map[line.category ?? 'Autre'] ??= []).push(line);
    for (const k in map) map[k].sort((a, b) => a.product_name.localeCompare(b.product_name, 'fr'));
    return map;
  }, [lines]);

  const families = useMemo(
    () => [
      ...FAMILY_ORDER.filter((k) => byFamily[k]?.length),
      ...Object.keys(byFamily).filter((k) => !FAMILY_ORDER.includes(k) && byFamily[k]?.length).sort(),
    ],
    [byFamily],
  );

  const [open, setOpen] = useState<Set<string>>(() => new Set(families.slice(0, 1)));

  const filledCount = (key: string) =>
    (byFamily[key] ?? []).filter((l) =>
      mode === 'initial' ? l.initial_qty > 0 : mode === 'reassort' ? l.reassort_qty > 0 : l.final_qty !== null,
    ).length;

  const totalFilled = families.reduce((s, k) => s + filledCount(k), 0);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        setTimeout(() => inputRefs.current[byFamily[key]?.[0]?.product_id]?.focus(), 150);
      }
      return next;
    });

  if (families.length === 0)
    return <div className="py-8 text-center text-sm text-stone-400">Aucun produit à afficher pour cette étape.</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 pb-1 text-sm text-stone-500">
        <span>
          {totalFilled > 0 ? (
            <>
              <strong className="text-stone-800">{totalFilled}</strong> produit(s) renseigné(s)
            </>
          ) : (
            'Aucune saisie encore'
          )}
        </span>
        <span className="text-xs text-stone-400">{lines.length} produit(s) au total</span>
      </div>

      {families.map((familyKey) => {
        const cfg = FAMILIES.find((f) => f.key === familyKey) ?? { key: familyKey, label: familyKey, emoji: '📋', color: 'bg-stone-50' };
        const fLines = byFamily[familyKey] ?? [];
        const isOpen = open.has(familyKey);
        const filled = filledCount(familyKey);
        return (
          <div key={familyKey} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => toggle(familyKey)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-stone-50 active:bg-stone-100"
            >
              <span className="select-none text-2xl">{cfg.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold leading-tight text-stone-900">{cfg.label}</p>
                <p className="mt-0.5 text-xs text-stone-400">
                  {fLines.length} produit{fLines.length > 1 ? 's' : ''}
                </p>
              </div>
              {filled > 0 ? (
                <span className="shrink-0 rounded-full border border-green-200 bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                  {filled}/{fLines.length} ✓
                </span>
              ) : (
                <span className="shrink-0 text-xs font-medium text-stone-300">0/{fLines.length}</span>
              )}
              <ChevronDown className={`h-5 w-5 shrink-0 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className={`divide-y divide-stone-100/70 border-t border-stone-100 ${cfg.color}`}>
                {mode === 'reassort' && (
                  <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                    Saisissez uniquement les quantités <strong>reçues</strong> en cours d'événement. Laissez à 0 sinon.
                  </p>
                )}
                {fLines.map((line) => {
                  const displayQty =
                    mode === 'initial'
                      ? line.initial_qty || ''
                      : mode === 'reassort'
                        ? line.reassort_qty || ''
                        : line.final_qty ?? '';
                  const totalIn = (line.initial_qty ?? 0) + (line.reassort_qty ?? 0);
                  const finalVal = mode === 'final' ? line.final_qty : null;
                  const consumed = finalVal !== null && finalVal !== undefined ? totalIn - finalVal : null;
                  const isAnomaly = consumed !== null && consumed < 0;
                  const field: keyof StockLine =
                    mode === 'initial' ? 'initial_qty' : mode === 'reassort' ? 'reassort_qty' : 'final_qty';
                  return (
                    <div key={line.product_id} className={`px-4 py-3 ${isAnomaly ? 'bg-red-50' : ''}`}>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight text-stone-900">{line.product_name}</p>
                          <p className="mt-0.5 text-xs text-stone-400">{line.unit}</p>
                          {mode === 'final' && totalIn > 0 && (
                            <p className="mt-1 text-xs text-stone-500">
                              Entré : {line.initial_qty}
                              {(line.reassort_qty ?? 0) > 0 ? ` + ${line.reassort_qty} réassort = ${totalIn}` : ` ${line.unit}`}
                              {consumed !== null && (
                                <span
                                  className={`ml-1 font-medium ${isAnomaly ? 'text-red-600' : consumed > 0 ? 'text-stone-700' : 'text-stone-400'}`}
                                >
                                  → {consumed >= 0 ? consumed : `⚠️ ${consumed}`} consommé(s)
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <input
                          ref={(el) => (inputRefs.current[line.product_id] = el)}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={displayQty}
                          placeholder="0"
                          onChange={(e) => {
                            const raw = e.target.value;
                            const val = raw === '' ? (mode === 'final' ? null : 0) : parseInt(raw) || 0;
                            onChange(line.product_id, field, val);
                          }}
                          className={`min-h-[56px] w-24 shrink-0 rounded-xl border-2 py-3 text-center text-xl font-bold transition-colors focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                            isAnomaly
                              ? 'border-red-300 bg-red-50 text-red-700'
                              : displayQty !== '' && displayQty !== 0
                                ? 'border-green-300 bg-green-50 text-green-800'
                                : 'border-stone-200 bg-white text-stone-800'
                          }`}
                        />
                      </div>

                      {mode === 'final' && line.final_qty !== null && line.final_qty > 0 && (
                        <select
                          value={line.product_state ?? 'fermé'}
                          onChange={(e) => onChange(line.product_id, 'product_state', e.target.value)}
                          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        >
                          {PRODUCT_STATES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      )}

                      {isAnomaly && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs font-medium text-red-600">
                            ⚠️ Stock final supérieur au stock entré — commentaire obligatoire (RG-004).
                          </p>
                          <input
                            value={line.anomaly_comment ?? ''}
                            onChange={(e) => onChange(line.product_id, 'anomaly_comment', e.target.value)}
                            placeholder="Expliquez l'écart…"
                            className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
