/**
 * MatchZoneHeader — en-tête responsable de zone (match) : identité, espace,
 * événement + bandeau statut. Bouton retour optionnel.
 */

import { useNavigate } from 'react-router-dom';
import { ChevronLeft, RefreshCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { MatchSession } from '@/hooks/useMatchSession';

const SPACE_BADGE: Record<string, string> = {
  vip: 'bg-amber-500 text-black',
  bar: 'bg-slate-800 text-white',
  buvette: 'bg-sky-600 text-white',
};

export function MatchZoneHeader({ session, back }: { session: MatchSession; back?: boolean }) {
  const navigate = useNavigate();
  const st = session.service_type;

  async function changeSpace() {
    // Déconnexion propre de la session courante avant de rechoisir un espace.
    await supabase.rpc('leave_session', { p_token: session.session_token });
    navigate(session.match_access_code ? `/match/${session.match_access_code}` : '/');
  }

  return (
    <header className="bg-[#1a1a2e] text-white">
      <div className="flex items-center gap-3 px-4 py-3">
        {back && (
          <button onClick={() => navigate(-1)} className="text-white/70 hover:text-white" aria-label="Retour">
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-black">
          PR
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{session.event_name}</p>
          <p className="truncate text-xs text-white/60">
            {session.space_name} · {session.staff_name}
          </p>
        </div>
        {st && (
          <span className={`rounded px-2 py-1 text-xs font-bold ${SPACE_BADGE[st] ?? 'bg-slate-600 text-white'}`}>
            {st.toUpperCase()}
          </span>
        )}
      </div>
      <button
        onClick={() => void changeSpace()}
        className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 py-2 text-xs text-white/60 transition-colors hover:text-white"
      >
        <RefreshCcw className="h-3.5 w-3.5" /> Changer d'espace
      </button>
    </header>
  );
}
