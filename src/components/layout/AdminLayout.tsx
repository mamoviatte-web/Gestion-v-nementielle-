/**
 * AdminLayout (ROLE_STADE) — sidebar noire animée + collapsible sur desktop,
 * bottom nav (4 items + « Plus ») sur mobile. Identité Provence Rugby.
 *
 * Navigation pilotée par UNE SEULE source (`navConfig`) — règle NN/g : ~5
 * destinations de 1er niveau, groupes repliables indentés, utilitaires discrets
 * en bas. « Analyses » et « Qualité des données » sont des pages à sous-onglets
 * (fusions) ; aucune page supprimée. État d'ouverture des groupes persisté.
 */

import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  Package,
  Boxes,
  Download,
  LogOut,
  AlertTriangle,
  TrendingUp,
  Users,
  ClipboardList,
  LineChart,
  Database,
  Ruler,
  Building2,
  Beer,
  ShieldCheck,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useLateProvidersCount } from '@/hooks/useProviders';
import { useInbox } from '@/hooks/useInbox';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { Logo } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: LucideIcon;
  badge?: 'inbox';
}
type NavNode =
  | ({ kind: 'primary' } & NavItem)
  | { kind: 'group'; id: string; label: string; defaultOpen: boolean; children: NavItem[] }
  | ({ kind: 'utility' } & NavItem);

/* ═══ SOURCE UNIQUE DE NAVIGATION ═══ */
const navConfig: NavNode[] = [
  { kind: 'primary', to: '/admin/dashboard', label: 'Tableau de bord', short: 'Accueil', icon: LayoutDashboard, badge: 'inbox' },
  { kind: 'primary', to: '/admin/events', label: 'Événements', icon: CalendarDays },
  { kind: 'primary', to: '/admin/stock', label: 'Stocks', icon: Boxes },
  { kind: 'primary', to: '/admin/analytics', label: 'Analyses', icon: TrendingUp },
  { kind: 'primary', to: '/admin/analytics/staff', label: 'Staff & RH', icon: Users },
  {
    kind: 'group', id: 'rh', label: 'Ressources humaines', defaultOpen: false,
    children: [
      { to: '/admin/rh/match', label: 'RH Match', short: 'RH Match', icon: ClipboardList },
      { to: '/admin/rh/analytique', label: 'RH Analytique', short: 'Analytique', icon: LineChart },
    ],
  },
  {
    kind: 'group', id: 'datapilot', label: 'DataPilot', defaultOpen: false,
    children: [
      { to: '/admin/datapilot/coefficients', label: 'Coefficients de conso', short: 'Coefficients', icon: Ruler },
      { to: '/admin/datapilot/capacites', label: 'Capacités & pax', short: 'Capacités', icon: Building2 },
      { to: '/admin/datapilot/facteurs', label: 'Facteurs historiques', short: 'Facteurs', icon: Database },
    ],
  },
  {
    kind: 'group', id: 'config', label: 'Configuration', defaultOpen: false,
    children: [
      { to: '/admin/catalog', label: 'Catalogue', icon: Package },
      { to: '/admin/spaces', label: 'Espaces', icon: Building2 },
      { to: '/admin/assortiment', label: 'Assortiment buvettes', short: 'Assortiment', icon: Beer },
    ],
  },
  { kind: 'utility', to: '/admin/audit', label: 'Qualité des données', short: 'Qualité', icon: ShieldCheck },
  { kind: 'utility', to: '/admin/access', label: 'Gestion des accès', short: 'Accès', icon: KeyRound },
  { kind: 'utility', to: '/admin/export', label: 'Export', icon: Download },
];

const PRIMARY = navConfig.filter((n): n is Extract<NavNode, { kind: 'primary' }> => n.kind === 'primary');
const GROUPS = navConfig.filter((n): n is Extract<NavNode, { kind: 'group' }> => n.kind === 'group');
const UTILITY = navConfig.filter((n): n is Extract<NavNode, { kind: 'utility' }> => n.kind === 'utility');
/** Ordre à plat (sidebar réduite + « Plus » mobile + palette) : primaires → groupes → utilitaire. */
const FLAT: NavItem[] = [...PRIMARY, ...GROUPS.flatMap((g) => g.children), ...UTILITY];
const MOBILE_MAIN = PRIMARY.slice(0, 4);
const MOBILE_MORE: NavItem[] = FLAT.slice(4);
const GROUP_STORAGE = 'stockpilot.navGroups';

/** /admin/analytics est préfixe de costs/staff/coefficients → match exact. */
const exactMatch = (to: string) => to === '/admin/analytics';

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: lateCount = 0 } = useLateProvidersCount();
  const { data: inboxItems } = useInbox();
  const inboxCount = inboxItems?.length ?? 0;
  const [collapsed, setCollapsed] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [palette, setPalette] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const defaults = Object.fromEntries(GROUPS.map((g) => [g.id, g.defaultOpen]));
    try {
      const saved = JSON.parse(localStorage.getItem(GROUP_STORAGE) || '{}') as Record<string, boolean>;
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  });

  // Persiste l'état d'ouverture des groupes entre sessions.
  useEffect(() => {
    try { localStorage.setItem(GROUP_STORAGE, JSON.stringify(openGroups)); } catch { /* stockage indisponible */ }
  }, [openGroups]);

  // Raccourci global ⌘K / Ctrl+K → palette de commande.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const initials = (user?.name ?? user?.email ?? 'MV')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'MV';

  /** Un lien de navigation (desktop) — gère actif, badge inbox, tooltip réduit. */
  function SideLink({ item, sub }: { item: NavItem; sub?: boolean }) {
    const { to, label, icon: Icon, badge } = item;
    return (
      <NavLink
        to={to}
        end={exactMatch(to)}
        className={({ isActive }) =>
          clsx(
            'group relative flex items-center gap-3 rounded-xl transition-all duration-150',
            collapsed ? 'justify-center px-2 py-3' : sub ? 'py-2 pl-9 pr-3' : 'px-3 py-2.5',
            isActive ? 'bg-pr-olive text-white' : 'text-pr-stone/60 hover:bg-white/5 hover:text-white',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute bottom-2 left-0 top-2 w-[3px] origin-top animate-slideDown rounded-full bg-pr-gold" />}
            <Icon className={clsx('h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110', sub && !collapsed && 'h-4 w-4', isActive && 'text-pr-gold')} />
            {!collapsed && <span className={clsx('flex-1 truncate leading-tight', sub ? 'text-[13px] font-medium' : 'text-sm font-medium')}>{label}</span>}
            {badge === 'inbox' && inboxCount > 0 && (
              <span className={clsx('inline-flex items-center justify-center rounded-full bg-pr-rust text-[10px] font-black text-white', collapsed ? 'absolute -right-0.5 -top-0.5 h-4 w-4' : 'ml-auto h-5 min-w-[20px] px-1')}>
                {inboxCount > 9 ? '9+' : inboxCount}
              </span>
            )}
            {collapsed && (
              <span className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-lg border border-white/10 bg-pr-black px-2.5 py-1.5 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {label}
              </span>
            )}
          </>
        )}
      </NavLink>
    );
  }

  return (
    <div className="flex min-h-full bg-pr-cream">
      {/* ── Sidebar desktop ─────────────────────────────────────────── */}
      <aside
        className={clsx(
          'relative z-10 hidden shrink-0 flex-col self-stretch bg-pr-black text-white transition-all duration-300 ease-in-out md:sticky md:top-0 md:flex md:h-screen print:!hidden',
          collapsed ? 'w-16' : 'w-52',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 overflow-hidden border-b border-white/10 px-4 py-5">
          <Logo variant="mark-white" size="sm" />
          {!collapsed && (
            <div className="leading-tight">
              <p className="whitespace-nowrap font-display text-[13px] font-bold tracking-[0.12em]">PROVENCE RUGBY</p>
              <p className="whitespace-nowrap text-[11px] text-pr-stone/60">Stade Maurice-David</p>
            </div>
          )}
        </div>
        {lateCount > 0 && !collapsed && (
          <div className="px-4 pt-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-pr-rust px-2 py-0.5 text-xs font-semibold text-white">
              <AlertTriangle className="h-3.5 w-3.5" /> {lateCount} en retard
            </span>
          </div>
        )}

        {/* Palette de commande ⌘K */}
        <div className="px-2 pt-2">
          <button
            onClick={() => setPalette(true)}
            title="Rechercher (⌘K)"
            className={clsx(
              'flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 text-pr-stone/60 transition-colors hover:bg-white/10 hover:text-white',
              collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2',
            )}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left text-[13px]">Aller à…</span>
                <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-pr-stone/50">⌘K</kbd>
              </>
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2 py-3">
          {collapsed ? (
            FLAT.map((item) => <SideLink key={item.to} item={item} />)
          ) : (
            <>
              {PRIMARY.map((item) => <SideLink key={item.to} item={item} />)}

              {GROUPS.map((g) => {
                const isOpen = openGroups[g.id];
                return (
                  <div key={g.id} className="pt-2">
                    <button
                      onClick={() => setOpenGroups((s) => ({ ...s, [g.id]: !s[g.id] }))}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-pr-stone/40 transition-colors hover:text-pr-stone/70"
                    >
                      <ChevronDown className={clsx('h-3 w-3 shrink-0 transition-transform', !isOpen && '-rotate-90')} />
                      {g.label}
                    </button>
                    {isOpen && <div className="mt-0.5 space-y-0.5">{g.children.map((item) => <SideLink key={item.to} item={item} sub />)}</div>}
                  </div>
                );
              })}

              <div className="mt-3 border-t border-white/10 pt-3">
                {UTILITY.map((item) => <SideLink key={item.to} item={item} />)}
              </div>
            </>
          )}
        </nav>

        {/* Bouton collapse (bord droit, ping au survol) */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Développer' : 'Réduire'}
          className="group absolute -right-3 top-1/2 z-20 flex h-12 w-6 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/20 bg-pr-black text-white/60 transition-all duration-200 hover:border-pr-gold hover:bg-pr-gold/20 hover:text-white"
        >
          <span className="absolute inset-0 rounded-full bg-pr-gold/30 opacity-0 group-hover:animate-ping group-hover:opacity-100" />
          {collapsed ? <ChevronRight size={12} className="relative z-10" /> : <ChevronLeft size={12} className="relative z-10" />}
        </button>

        {/* User / déconnexion */}
        <div className="flex items-center gap-3 border-t border-white/10 px-3 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-pr-gold/30 bg-pr-gold/20 text-xs font-black text-pr-gold">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white/90">{user?.name ?? user?.email}</p>
              <button onClick={handleLogout} className="flex items-center gap-1 text-[10px] text-white/40 transition-colors hover:text-white/70">
                <LogOut size={9} /> Déconnexion
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Contenu ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header mobile */}
        <header className="flex items-center justify-between bg-pr-black px-4 py-3 md:hidden print:hidden">
          <div className="flex items-center gap-2">
            <Logo variant="mark-white" size="sm" />
            <p className="font-display text-sm font-bold tracking-[0.1em] text-white">PROVENCE RUGBY</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setPalette(true)} className="text-pr-stone/80" aria-label="Rechercher">
              <Search className="h-5 w-5" />
            </button>
            {lateCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-pr-rust px-2 py-0.5 text-xs font-semibold text-white">
                <AlertTriangle className="h-3.5 w-3.5" /> {lateCount}
              </span>
            )}
            <button onClick={handleLogout} className="text-pr-stone/80" aria-label="Déconnexion">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <AlertBanner />

        <main className="flex-1 px-4 py-5 pb-24 md:px-8 md:pb-8">
          <Outlet />
        </main>

        {/* ── Bottom nav mobile : 4 items + Plus ── */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-white/10 bg-pr-black pb-[env(safe-area-inset-bottom)] md:hidden">
          {MOBILE_MAIN.map(({ to, label, short, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={exactMatch(to)}
              className={({ isActive }) =>
                clsx('relative flex flex-1 flex-col items-center justify-center gap-0.5', isActive ? 'text-pr-gold' : 'text-white/40 active:text-white/80')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-pr-gold" />}
                  <span className="relative">
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                    {badge === 'inbox' && inboxCount > 0 && (
                      <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-pr-rust px-0.5 text-[9px] font-black text-white">
                        {inboxCount > 9 ? '9+' : inboxCount}
                      </span>
                    )}
                  </span>
                  <span className="text-[9px] font-semibold tracking-wide">{short ?? label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button onClick={() => setShowMore(true)} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-white/40 active:text-white/80">
            <MoreHorizontal size={20} strokeWidth={1.8} />
            <span className="text-[9px] font-semibold tracking-wide">Plus</span>
          </button>
        </nav>

        {/* ── Sheet « Plus » ── */}
        {showMore && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowMore(false)} />
            <div className="absolute inset-x-0 bottom-0 animate-slideUp rounded-t-3xl bg-pr-black pb-[env(safe-area-inset-bottom)]">
              <div className="flex justify-center pb-1 pt-3">
                <div className="h-1 w-10 rounded-full bg-white/20" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3">
                <p className="text-base font-bold text-white">Navigation</p>
                <button onClick={() => setShowMore(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/60">
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1 px-3 pb-5">
                {MOBILE_MORE.map(({ to, label, short, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={exactMatch(to)}
                    onClick={() => setShowMore(false)}
                    className={({ isActive }) =>
                      clsx(
                        'flex flex-col items-center gap-1.5 rounded-2xl px-2 py-4 transition-colors',
                        isActive ? 'bg-pr-gold/20 text-pr-gold' : 'text-white/60 active:bg-white/10 active:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                        <span className="text-center text-[11px] font-semibold leading-tight">{short ?? label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} screens={FLAT} />
    </div>
  );
}
