/**
 * InboxPanel — « À traiter » : file d'actions unifiée du Tableau de bord.
 * Même source que le badge « 9+ » de la sidebar (hook useInbox) → un seul chiffre
 * de référence. Chaque item renvoie vers l'écran où le résoudre. Lecture seule.
 * Présentation : système visuel homogène (pastille de statut + titre + action accent).
 */

import { Link } from 'react-router-dom';
import { Inbox, ChevronRight, PackageX, ClipboardCheck, ShieldAlert, CheckCircle2, type LucideIcon } from 'lucide-react';
import { useInbox, type InboxItem, type InboxKind } from '@/hooks/useInbox';

const KIND_ICON: Record<InboxKind, LucideIcon> = {
  'Saisie stock': PackageX,
  Débrief: ClipboardCheck,
  Anomalie: ShieldAlert,
};

export function InboxPanel() {
  const { data, isLoading } = useInbox();
  const items: InboxItem[] = data ?? [];

  if (isLoading && items.length === 0) return null;

  if (items.length === 0) {
    return (
      <div className="mb-5 flex items-center gap-3 rounded-2xl px-4 py-3" style={{ border: '1px solid var(--good-bg)', background: 'var(--good-bg)' }}>
        <CheckCircle2 size={18} style={{ color: 'var(--good)' }} />
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--good)' }}>Rien à traiter</p>
          <p className="text-xs" style={{ color: 'var(--ink-2)' }}>Stocks, débriefs et anomalies sont à jour.</p>
        </div>
      </div>
    );
  }

  const critCount = items.filter((i) => i.sev === 'crit').length;

  return (
    <section className="inbox card mb-5 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--line-soft)' }}>
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: 'var(--ink)' }}>
          <Inbox size={17} />
          <span className="num absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white" style={{ background: 'var(--crit)' }}>
            {items.length > 9 ? '9+' : items.length}
          </span>
        </div>
        <div>
          <h2 className="text-sm font-black" style={{ color: 'var(--ink)' }}>À traiter</h2>
          <p className="num text-[11px]" style={{ color: 'var(--muted)' }}>
            {items.length} action{items.length > 1 ? 's' : ''}{critCount > 0 ? ` · ${critCount} critique${critCount > 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>
      <div>
        {items.map((it) => {
          const Icon = KIND_ICON[it.kind];
          const dot = it.sev === 'crit' ? 'crit' : 'warn';
          return (
            <Link key={it.key} to={it.to} className="row transition-colors hover:bg-[var(--surface-2)]">
              <span className={`dot ${dot}`} />
              <Icon size={15} className="shrink-0" style={{ color: 'var(--ink-2)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>{it.label}</span>
                {it.sub && <span className="block truncate text-[11px]" style={{ color: 'var(--muted)' }}>{it.sub}</span>}
              </span>
              <span className="act shrink-0">{it.kind}</span>
              <ChevronRight size={15} className="shrink-0" style={{ color: 'var(--line)' }} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
