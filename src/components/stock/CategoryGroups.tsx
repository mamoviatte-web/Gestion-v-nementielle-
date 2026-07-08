/**
 * CategoryGroups — regroupe des lignes de saisie stock en accordéons par
 * catégorie (mobile-first). Réutilisable pour ouverture / réassort / clôture.
 * Icônes + badge « X saisis » + première catégorie ouverte par défaut.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const CATEGORY_ORDER = ['Bières', 'Vins', 'Soft', 'Sirops', 'Spiritueux', 'Matériel'];
const CATEGORY_ICONS: Record<string, string> = {
  Bières: '🍺',
  Vins: '🍷',
  Soft: '🥤',
  Sirops: '🍹',
  Spiritueux: '🥃',
  Matériel: '📦',
};

export interface CategoryItem<T> {
  /** Identifiant unique de la ligne (React key). */
  id: string;
  /** Catégorie du produit (ex : « Bières »). */
  category: string;
  /** Nom pour le tri alphabétique intra-catégorie. */
  sortName: string;
  /** true si une quantité a été saisie (badge « saisi »). */
  filled: boolean;
  data: T;
}

export function CategoryGroups<T>({
  items,
  renderItem,
  totalLabel,
}: {
  items: CategoryItem<T>[];
  renderItem: (data: T) => ReactNode;
  totalLabel?: (filled: number, total: number) => string;
}) {
  const byCategory = useMemo(() => {
    const map = new Map<string, CategoryItem<T>[]>();
    for (const it of items) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.sortName.localeCompare(b.sortName, 'fr'));
    return map;
  }, [items]);

  const categories = useMemo(() => {
    const present = [...byCategory.keys()];
    const ordered = CATEGORY_ORDER.filter((c) => byCategory.has(c));
    const others = present.filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...ordered, ...others];
  }, [byCategory]);

  const [open, setOpen] = useState<Set<string>>(() => new Set(categories.slice(0, 1)));

  const totalFilled = items.filter((i) => i.filled).length;

  return (
    <div className="space-y-2">
      {totalLabel && (
        <p className="pb-1 text-sm text-slate-500">{totalLabel(totalFilled, items.length)}</p>
      )}
      {categories.map((cat) => {
        const catItems = byCategory.get(cat) ?? [];
        const isOpen = open.has(cat);
        const filled = catItems.filter((i) => i.filled).length;
        return (
          <div key={cat} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  next.has(cat) ? next.delete(cat) : next.add(cat);
                  return next;
                })
              }
              className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                <span className="text-xl">{CATEGORY_ICONS[cat] ?? '📋'}</span>
                <span className="font-semibold text-slate-800">{cat}</span>
                <span className="text-xs text-slate-400">
                  ({catItems.length} produit{catItems.length > 1 ? 's' : ''})
                </span>
              </span>
              <span className="flex items-center gap-2">
                {filled > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    {filled} saisi{filled > 1 ? 's' : ''}
                  </span>
                )}
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                )}
              </span>
            </button>
            {isOpen && (
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {catItems.map((it) => (
                  <div key={it.id}>{renderItem(it.data)}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
