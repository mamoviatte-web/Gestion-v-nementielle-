/**
 * InboxPanel — « À traiter » : file d'actions unifiée du Tableau de bord.
 * Même source que le badge « 9+ » de la sidebar (hook useInbox) → un seul chiffre
 * de référence. Chaque item renvoie vers l'écran où le résoudre. Lecture seule.
 */

import { Link } from 'react-router-dom';
import { Inbox, ChevronRight, PackageX, ClipboardCheck, ShieldAlert, type LucideIcon } from 'lucide-react';
import { useInbox, type InboxItem, type InboxKind } from '@/hooks/useInbox';

const KIND_ICON: Record<InboxKind, LucideIcon> = {
  'Saisie stock': PackageX,
  Débrief: ClipboardCheck,
  Anomalie: ShieldAlert,
};
const SEV_STYLE = {
  crit: 'bg-rose-100 text-rose-700',
  warn: 'bg-amber-100 text-amber-700',
} as const;

export function InboxPanel() {
  const { data, isLoading } = useInbox();
  const items: InboxItem[] = data ?? [];

  if (isLoading && items.length === 0) return null;

  if (items.length === 0) {
    return (
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white"><Inbox size={17} /></div>
        <div>
          <p className="text-sm font-bold text-emerald-800">Rien à traiter</p>
          <p className="text-xs text-emerald-600">Stocks, débriefs et anomalies sont à jour.</p>
        </div>
      </div>
    );
  }

  const critCount = items.filter((i) => i.sev === 'crit').length;

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-pr-black text-white">
          <Inbox size={17} />
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-pr-rust px-1 text-[10px] font-black text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        </div>
        <div>
          <h2 className="text-sm font-black text-stone-900">À traiter</h2>
          <p className="text-[11px] text-stone-400">
            {items.length} action{items.length > 1 ? 's' : ''}{critCount > 0 ? ` · ${critCount} critique${critCount > 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>
      <div className="divide-y divide-stone-100">
        {items.map((it) => {
          const Icon = KIND_ICON[it.kind];
          return (
            <Link key={it.key} to={it.to} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-stone-50">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${SEV_STYLE[it.sev]}`}><Icon size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-stone-800">{it.label}</span>
                {it.sub && <span className="block truncate text-[11px] text-stone-400">{it.sub}</span>}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${SEV_STYLE[it.sev]}`}>{it.kind}</span>
              <ChevronRight size={15} className="shrink-0 text-stone-300" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
