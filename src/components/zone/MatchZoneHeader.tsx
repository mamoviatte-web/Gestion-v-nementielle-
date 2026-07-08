/**
 * MatchZoneHeader — en-tête responsable de zone (match) : identité, espace,
 * événement + bandeau statut. Bouton retour optionnel.
 */

import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import type { MatchSession } from '@/hooks/useMatchSession';

const SPACE_BADGE: Record<string, string> = {
  vip: 'bg-amber-500 text-black',
  bar: 'bg-slate-800 text-white',
  buvette: 'bg-sky-600 text-white',
};

export function MatchZoneHeader({ session, back }: { session: MatchSession; back?: boolean }) {
  const navigate = useNavigate();
  const st = session.service_type;
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
    </header>
  );
}
