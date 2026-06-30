/**
 * ProviderLayout (ROLE_RESPONSABLE) — header espace coloré par TYPE d'espace
 * (identification terrain) + rameau Provence Rugby + onglets.
 */

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Boxes, Clock, MessageSquare, LogOut, WifiOff, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { supabase } from '@/lib/supabase';
import { Logo } from '@/components/ui';
import type { SpaceType } from '@/lib/types';

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

/** Thème du header par type d'espace (différenciation terrain — étape 4/6). */
const TYPE_THEME: Record<
  SpaceType,
  { bg: string; text: string; subtle: string; mark: 'mark' | 'mark-white'; tab: string; tabActive: string }
> = {
  VIP: {
    bg: 'bg-pr-black-soft',
    text: 'text-white',
    subtle: 'text-pr-stone/70',
    mark: 'mark-white',
    tab: 'bg-white/15 text-white/85 hover:bg-white/25',
    tabActive: 'bg-white text-pr-black',
  },
  Bar: {
    bg: 'bg-pr-olive',
    text: 'text-white',
    subtle: 'text-white/70',
    mark: 'mark-white',
    tab: 'bg-white/15 text-white/85 hover:bg-white/25',
    tabActive: 'bg-white text-pr-olive-dark',
  },
  Buvette: {
    bg: 'bg-pr-gold',
    text: 'text-pr-black',
    subtle: 'text-pr-black/60',
    mark: 'mark',
    tab: 'bg-black/10 text-pr-black/70 hover:bg-black/20',
    tabActive: 'bg-pr-black text-white',
  },
};

export function ProviderLayout() {
  const { user, responsableName, logout } = useAuth();
  const navigate = useNavigate();
  const online = useNetworkStatus();

  const { data: spaceType } = useQuery({
    queryKey: ['mySpaceType', user?.spaceId],
    enabled: !!user?.spaceId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SpaceType | null> => {
      const { data } = await supabase
        .from('spaces')
        .select('space_type')
        .eq('space_id', user!.spaceId)
        .maybeSingle();
      return (data?.space_type as SpaceType | undefined) ?? null;
    },
  });

  const theme = TYPE_THEME[spaceType ?? 'VIP'];

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-full flex-col bg-pr-cream">
      <header className={clsx('px-4 py-3', theme.bg, theme.text)}>
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Logo variant={theme.mark} size="sm" className="!w-5 [&_svg]:h-5 [&_svg]:w-5" />
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold tracking-wide">
                {user?.spaceCode ?? 'Espace'}
              </p>
              <p className={clsx('truncate text-xs', theme.subtle)}>
                {spaceType ?? ''}
                {responsableName ? ` · ${responsableName}` : ''}
                {user?.spaceCode ? ` · ${user.spaceCode}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!online && (
              <span className="inline-flex items-center gap-1 rounded-full bg-pr-rust px-2 py-0.5 text-xs font-semibold text-white">
                <WifiOff className="h-3.5 w-3.5" /> Hors ligne
              </span>
            )}
            <button
              onClick={handleLogout}
              className={clsx('flex items-center gap-1 text-sm hover:opacity-80', theme.subtle)}
            >
              <LogOut className="h-4 w-4" /> Quitter
            </button>
          </div>
        </div>

        <nav className="mt-3 flex gap-1">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? theme.tabActive : theme.tab,
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
