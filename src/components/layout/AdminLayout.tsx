/**
 * AdminLayout (ROLE_STADE) — sidebar noire animée + collapsible sur desktop,
 * bottom nav (4 items + « Plus ») sur mobile. Identité Provence Rugby.
 */

import { useState } from 'react';
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
  Wallet,
  Users,
  UserPlus,
  Ruler,
  Building2,
  Beer,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useLateProvidersCount } from '@/hooks/useProviders';
import { useCriticalStatus } from '@/hooks/useDashboardLive';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { Logo } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/admin/dashboard', label: 'Tableau de bord', short: 'Accueil', icon: LayoutDashboard },
  { to: '/admin/events', label: 'Événements', icon: CalendarDays },
  { to: '/admin/stock', label: 'Stocks', icon: Boxes },
  { to: '/admin/analytics', label: 'Analyses', icon: TrendingUp },
  { to: '/admin/analytics/costs', label: 'Contrôle de charges', short: 'Charges', icon: Wallet },
  { to: '/admin/analytics/staff', label: 'Staff & RH', icon: Users },
  { to: '/admin/analytics/coefficients', label: 'Coefficients espace', short: 'Coeff.', icon: Ruler },
  { to: '/admin/rh/preplan', label: 'Planning RH Match', short: 'Planning RH', icon: UserPlus },
  { to: '/admin/rh/populations', label: 'Populations RH', short: 'Populations', icon: Users },
  { to: '/admin/catalog', label: 'Catalogue', icon: Package },
  { to: '/admin/spaces', label: 'Espaces', icon: Building2 },
  { to: '/admin/assortiment', label: 'Assortiment buvettes', short: 'Assortiment', icon: Beer },
  { to: '/admin/access', label: 'Gestion des accès', short: 'Accès', icon: KeyRound },
  { to: '/admin/export', label: 'Export', icon: Download },
];
const MAIN = NAV.slice(0, 4); // Accueil · Événements · Stocks · Analyses
const MORE = NAV.slice(4); // reste → sheet « Plus »

/** /admin/analytics est préfixe de costs/staff/coefficients → match exact. */
const exactMatch = (to: string) => to === '/admin/analytics';

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: lateCount = 0 } = useLateProvidersCount();
  const { data: critStatus } = useCriticalStatus();
  const criticalAlerts = critStatus?.criticalAlerts ?? 0;
  const [collapsed, setCollapsed] = useState(false);
  const [showMore, setShowMore] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const initials = (user?.name ?? user?.email ?? 'MV')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'MV';

  return (
    <div className="flex min-h-full bg-pr-cream">
      {/* ── Sidebar desktop ─────────────────────────────────────────── */}
      <aside
        className={clsx(
          'relative z-10 hidden shrink-0 flex-col self-stretch bg-pr-black text-white transition-all duration-300 ease-in-out md:sticky md:top-0 md:flex md:h-screen',
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

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2 py-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={exactMatch(to)}
              className={({ isActive }) =>
                clsx(
                  'group relative flex items-center gap-3 rounded-xl transition-all duration-150',
                  collapsed ? 'justify-center px-2 py-3' : 'px-3 py-2.5',
                  isActive ? 'bg-pr-olive text-white' : 'text-pr-stone/60 hover:bg-white/5 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute bottom-2 left-0 top-2 w-[3px] origin-top animate-slideDown rounded-full bg-pr-gold" />
                  )}
                  <Icon className={clsx('h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110', isActive && 'text-pr-gold')} />
                  {!collapsed && <span className="flex-1 truncate text-sm font-medium leading-tight">{label}</span>}
                  {to === '/admin/dashboard' && criticalAlerts > 0 && (
                    <span
                      className={clsx(
                        'inline-flex items-center justify-center rounded-full bg-pr-rust text-[10px] font-black text-white',
                        collapsed ? 'absolute -right-0.5 -top-0.5 h-4 w-4' : 'ml-auto h-5 min-w-[20px] px-1',
                      )}
                    >
                      {criticalAlerts > 9 ? '9+' : criticalAlerts}
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
          ))}
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
        <header className="flex items-center justify-between bg-pr-black px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <Logo variant="mark-white" size="sm" />
            <p className="font-display text-sm font-bold tracking-[0.1em] text-white">PROVENCE RUGBY</p>
          </div>
          <div className="flex items-center gap-3">
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
          {MAIN.map(({ to, label, short, icon: Icon }) => (
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
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
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
                {MORE.map(({ to, label, short, icon: Icon }) => (
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
    </div>
  );
}
