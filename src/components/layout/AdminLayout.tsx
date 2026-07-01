/**
 * AdminLayout (ROLE_STADE) — sidebar noire (identité Provence Rugby) sur
 * desktop, barre d'onglets en bas sur mobile.
 */

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  Package,
  Boxes,
  Building2,
  Download,
  LogOut,
  AlertTriangle,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useLateProvidersCount } from '@/hooks/useProviders';
import { Logo } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/admin/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/admin/events', label: 'Événements', icon: CalendarDays },
  { to: '/admin/stock', label: 'Stocks', icon: Boxes },
  { to: '/admin/analytics', label: 'Analyses', icon: TrendingUp },
  { to: '/admin/analytics/staff', label: 'Staff & RH', icon: Users },
  { to: '/admin/catalog', label: 'Catalogue', icon: Package },
  { to: '/admin/spaces', label: 'Espaces', icon: Building2 },
  { to: '/admin/export', label: 'Export', icon: Download },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: lateCount = 0 } = useLateProvidersCount();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const lateBadge = lateCount > 0 && (
    <span className="inline-flex items-center gap-1 rounded-full bg-pr-rust px-2 py-0.5 text-xs font-semibold text-white">
      <AlertTriangle className="h-3.5 w-3.5" /> {lateCount} en retard
    </span>
  );

  return (
    <div className="flex min-h-full bg-pr-cream">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-52 flex-col bg-pr-black text-white md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo variant="mark-white" size="sm" />
          <div className="leading-tight">
            <p className="font-display text-[13px] font-bold tracking-[0.12em]">
              PROVENCE RUGBY
            </p>
            <p className="text-[11px] text-pr-stone/60">Stade Maurice-David</p>
          </div>
        </div>
        {lateBadge && <div className="px-5 pb-2">{lateBadge}</div>}

        <nav className="flex-1 space-y-1 px-3 pt-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg border-l-[3px] px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-pr-gold bg-pr-olive text-white'
                    : 'border-transparent text-pr-stone/70 hover:bg-white/10 hover:text-white',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <p className="px-2 pb-2 text-xs text-pr-stone/60">{user?.name}</p>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-pr-stone/70 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-5 w-5" /> Déconnexion
          </button>
        </div>
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header mobile */}
        <header className="flex items-center justify-between bg-pr-black px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <Logo variant="mark-white" size="sm" />
            <p className="font-display text-sm font-bold tracking-[0.1em] text-white">
              PROVENCE RUGBY
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lateBadge}
            <button onClick={handleLogout} className="text-pr-stone/80" aria-label="Déconnexion">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 pb-24 md:px-8 md:pb-8">
          <Outlet />
        </main>

        {/* Bottom tabs (mobile) */}
        <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-pr-stone bg-white md:hidden">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                  isActive ? 'text-pr-olive' : 'text-pr-black-soft/40',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
