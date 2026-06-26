/**
 * ProviderLayout (ROLE_RESPONSABLE) — header espace + onglets
 * Stocks / Horaires / Débrief.
 *
 * L'accès aux onglets exige que le nom du responsable ait été saisi (RG-001) :
 * tant que ce n'est pas le cas, on redirige vers /provider/home.
 */

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Boxes, Clock, MessageSquare, LogOut, WifiOff, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

interface TabItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabItem[] = [
  { to: '/provider/stock', label: 'Stocks', icon: Boxes },
  { to: '/provider/schedule', label: 'Horaires', icon: Clock },
  { to: '/provider/debrief', label: 'Débrief', icon: MessageSquare },
];

export function ProviderLayout() {
  const { user, responsableName, logout } = useAuth();
  const navigate = useNavigate();
  const online = useNetworkStatus();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      {/* Header espace */}
      <header className="bg-provence px-4 py-3 text-white">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">
              {user?.spaceCode ?? 'Espace'}
            </p>
            {responsableName && (
              <p className="truncate text-xs text-slate-300">
                Responsable : {responsableName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!online && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
                <WifiOff className="h-3.5 w-3.5" /> Hors ligne
              </span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-sm text-slate-300 hover:text-white"
            >
              <LogOut className="h-4 w-4" /> Quitter
            </button>
          </div>
        </div>

        {/* Onglets */}
        <nav className="mt-3 flex gap-1">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white text-provence'
                    : 'bg-white/10 text-slate-200 hover:bg-white/20',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
