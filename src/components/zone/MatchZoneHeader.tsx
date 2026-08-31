/**
 * MatchZoneHeader — en-tête responsable de zone (match) : identité, espace,
 * événement + bandeau statut. Bouton retour optionnel.
 *
 * Sélecteur « Mes zones » : un responsable qui gère plusieurs zones (ex. 3 buvettes)
 * bascule de l'une à l'autre SANS se reconnecter. La sous-page courante
 * (stocks / débrief / horaires) est conservée. La réactivation de la session cible
 * est automatique (get_match_session réactive le token au chargement).
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, RefreshCcw, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { MatchSession } from '@/hooks/useMatchSession';

const SPACE_BADGE: Record<string, string> = {
  vip: 'bg-amber-500 text-black',
  bar: 'bg-slate-800 text-white',
  buvette: 'bg-sky-600 text-white',
};

interface MyZone {
  space_id: string;
  space_name: string;
  service_type: string | null;
  session_token: string;
  is_current: boolean;
  stock_started: boolean;
  stock_done: boolean;
  debrief_done: boolean;
}

export function MatchZoneHeader({ session, back }: { session: MatchSession; back?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const st = session.service_type;
  const [zones, setZones] = useState<MyZone[]>([]);
  const [open, setOpen] = useState(false);

  const loadZones = useCallback(async () => {
    if (!session.session_token) return;
    const { data } = await supabase.rpc('get_my_zones', { p_token: session.session_token });
    const r = data as { success?: boolean; zones?: MyZone[] } | null;
    if (r?.success) setZones(r.zones ?? []);
  }, [session.session_token]);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  const multi = zones.length >= 2;

  // Sous-page courante (après le token) conservée au changement de zone.
  function subPath(): string {
    const rest = location.pathname.split(`/zone/match/${session.session_token}`)[1] ?? '';
    return rest || '';
  }

  function switchTo(z: MyZone) {
    setOpen(false);
    if (z.is_current) return;
    navigate(`/zone/match/${z.session_token}${subPath()}`);
  }

  async function changeSpace() {
    // Ajouter/rejoindre une AUTRE zone via le code (déconnexion propre de la courante).
    await supabase.rpc('leave_session', { p_token: session.session_token });
    navigate(session.match_access_code ? `/match/${session.match_access_code}` : '/');
  }

  return (
    <header className="relative bg-[#1a1a2e] text-white">
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
          {/* Nom de zone cliquable si le responsable gère plusieurs zones */}
          <button
            type="button"
            disabled={!multi}
            onClick={() => setOpen((v) => !v)}
            className={`flex max-w-full items-center gap-1 truncate text-xs text-white/60 ${multi ? 'hover:text-white' : 'cursor-default'}`}
          >
            <span className="truncate">
              {session.space_name} · {session.staff_name}
            </span>
            {multi && <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />}
          </button>
        </div>
        {multi && (
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
            {zones.length} zones
          </span>
        )}
        {st && (
          <span className={`rounded px-2 py-1 text-xs font-bold ${SPACE_BADGE[st] ?? 'bg-slate-600 text-white'}`}>
            {st.toUpperCase()}
          </span>
        )}
      </div>

      {/* Panneau « Mes zones » */}
      {multi && open && (
        <div className="absolute inset-x-0 top-full z-20 border-t border-white/10 bg-[#20203a] shadow-xl">
          <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-white/40">Mes zones ce soir</p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {zones.map((z) => {
              const state = z.stock_done && z.debrief_done ? 'done' : z.stock_started || z.stock_done || z.debrief_done ? 'started' : 'todo';
              return (
                <li key={z.session_token}>
                  <button
                    type="button"
                    onClick={() => switchTo(z)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                      z.is_current ? 'bg-white/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        state === 'done' ? 'bg-green-400' : state === 'started' ? 'bg-amber-400' : 'bg-white/25'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{z.space_name}</span>
                      <span className="block text-[11px] text-white/50">
                        {z.stock_done ? '📦 Stock clôturé' : z.stock_started ? '📦 Stock en cours' : '📦 Stock à faire'}
                        {z.debrief_done ? ' · 📝 Débrief ✓' : ''}
                      </span>
                    </span>
                    {z.is_current && <Check className="h-4 w-4 shrink-0 text-amber-400" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            onClick={() => void changeSpace()}
            className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 py-2.5 text-xs text-white/60 hover:text-white"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> Ajouter / rejoindre une autre zone
          </button>
        </div>
      )}

      {/* Un seul espace : bouton classique « Changer d'espace » */}
      {!multi && (
        <button
          onClick={() => void changeSpace()}
          className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 py-2 text-xs text-white/60 transition-colors hover:text-white"
        >
          <RefreshCcw className="h-3.5 w-3.5" /> Changer d'espace
        </button>
      )}
    </header>
  );
}
