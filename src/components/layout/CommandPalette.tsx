/**
 * CommandPalette — palette de commande ⌘K (ROLE_STADE). Recherche unifiée pour
 * sauter à n'importe quel écran, match/événement ou produit, sans fouiller le
 * menu. Navigation clavier (↑ ↓ ⏎ Échap). Lecture seule (aucune écriture).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, CornerDownLeft, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useEventsList } from '@/hooks/useEvents';
import type { Event } from '@/lib/types';

export interface PaletteScreen {
  to: string;
  label: string;
  icon: LucideIcon;
}
type Kind = 'Écran' | 'Match' | 'Produit';
interface Entry {
  kind: Kind;
  label: string;
  sub?: string;
  to: string;
  icon?: LucideIcon;
}

/** Minuscule + sans accents pour une recherche tolérante. */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const KIND_STYLE: Record<Kind, string> = {
  'Écran': 'bg-slate-100 text-slate-500',
  Match: 'bg-amber-100 text-amber-700',
  Produit: 'bg-sky-100 text-sky-700',
};

export function CommandPalette({ open, onClose, screens }: { open: boolean; onClose: () => void; screens: PaletteScreen[] }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const eventsQ = useEventsList();
  const productsQ = useQuery({
    queryKey: ['paletteProducts'],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      // RG-003 : jamais de prix ici — uniquement nom + catégorie.
      const { data } = await supabase.from('products').select('product_id, product_name, category, active').eq('active', true).order('product_name');
      return (data as { product_id: string; product_name: string; category: string | null }[] | null) ?? [];
    },
  });

  // Réinitialise à l'ouverture + focus.
  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  const entries: Entry[] = useMemo(() => {
    const scr: Entry[] = screens.map((s) => ({ kind: 'Écran', label: s.label, to: s.to, icon: s.icon }));
    const evs: Entry[] = ((eventsQ.data as Event[] | undefined) ?? []).map((e) => ({
      kind: 'Match',
      label: e.event_name,
      sub: `${e.event_type ?? 'événement'} · ${new Date(e.event_date).toLocaleDateString('fr-FR')}`,
      to: `/admin/events/${e.event_id}`,
    }));
    const prods: Entry[] = (productsQ.data ?? []).map((p) => ({
      kind: 'Produit',
      label: p.product_name,
      sub: `${p.category ?? '—'} · Catalogue`,
      to: '/admin/catalog',
    }));
    return [...scr, ...evs, ...prods];
  }, [screens, eventsQ.data, productsQ.data]);

  const results: Entry[] = useMemo(() => {
    const needle = norm(q.trim());
    if (!needle) return entries.filter((e) => e.kind === 'Écran'); // par défaut : les écrans
    return entries.filter((e) => norm(e.label).includes(needle) || (e.sub ? norm(e.sub).includes(needle) : false)).slice(0, 40);
  }, [entries, q]);

  // Clamp la sélection quand la liste change.
  useEffect(() => {
    setSel((s) => (results.length ? Math.min(s, results.length - 1) : 0));
  }, [results.length]);

  function go(entry: Entry | undefined) {
    if (!entry) return;
    onClose();
    navigate(entry.to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  // Fait défiler l'élément sélectionné dans la vue.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-stone-100 px-4">
          <Search size={17} className="text-stone-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={onKeyDown}
            placeholder="Aller à… un écran, un match, un produit"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-stone-400"
          />
          <kbd className="rounded-md border border-stone-200 px-1.5 py-0.5 text-[10px] font-semibold text-stone-400">Échap</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-stone-400">Aucun résultat pour « {q} ».</p>
          ) : (
            results.map((e, i) => {
              const Icon = e.icon;
              return (
                <button
                  key={`${e.kind}-${e.to}-${e.label}-${i}`}
                  data-idx={i}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(e)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === sel ? 'bg-pr-cream' : ''}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
                    {Icon ? <Icon size={15} /> : <span className="text-xs font-bold">{e.kind[0]}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-stone-800">{e.label}</span>
                    {e.sub && <span className="block truncate text-[11px] text-stone-400">{e.sub}</span>}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${KIND_STYLE[e.kind]}`}>{e.kind}</span>
                  {i === sel && <CornerDownLeft size={13} className="shrink-0 text-stone-300" />}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-stone-100 px-4 py-2 text-[11px] text-stone-400">
          <span><kbd className="font-semibold">↑↓</kbd> naviguer</span>
          <span><kbd className="font-semibold">⏎</kbd> ouvrir</span>
          <span className="ml-auto">{results.length} résultat{results.length > 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}
