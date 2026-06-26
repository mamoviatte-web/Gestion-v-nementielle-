/**
 * AdminLayout (ROLE_STADE) — sidebar sur desktop, barre d'onglets en bas
 * sur mobile.
 */

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  Package,
  Building2,
  Download,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/context/AuthContext';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/admin/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/admin/events', label: 'Événements', icon: CalendarDays },
  { to: '/admin/catalog', label: 'Catalogue', icon: Package },
  { to: '/admin/spaces', label: 'Espaces', icon: Building2 },
  { to: '/admin/export', label: 'Export', icon: Download },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-full bg-slate-50">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 flex-col bg-provence text-white md:flex">
        <div className="px-5 py-5">
          <p className="text-lg font-bold leading-tight">Stade Maurice David</p>
          <p className="text-xs text-slate-300">Back-office Stade</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <p className="px-2 pb-2 text-xs text-slate-300">{user?.name}</p>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-5 w-5" /> Déconnexion
          </button>
        </div>
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header mobile */}
        <header className="flex items-center justify-between border-b bg-white px-4 py-3 md:hidden">
          <p className="font-semibold text-provence">Stade Maurice David</p>
          <button
            onClick={handleLogout}
            className="text-slate-500"
            aria-label="Déconnexion"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </header>

        <main className="flex-1 px-4 py-5 pb-24 md:px-8 md:pb-8">
          <Outlet />
        </main>

        {/* Bottom tabs (mobile) */}
        <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-white md:hidden">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                  isActive ? 'text-provence' : 'text-slate-400',
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
