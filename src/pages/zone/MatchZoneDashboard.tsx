/**
 * MatchZoneDashboard — tableau de bord public d'un responsable de zone (match).
 * Chargé par le token de session (get_match_session). Affiche l'espace, le nom,
 * et l'accès aux sections opérationnelles (feuille de route, stocks, débrief).
 * Route : /zone/match/:sessionToken
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

interface MatchSession {
  success: boolean;
  session_token: string;
  event_id: string;
  event_name: string;
  event_date: string;
  space_id: string;
  space_name: string;
  service_type: 'vip' | 'bar' | 'buvette' | null;
  staff_name: string;
  error?: string;
}

function frDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function MatchZoneDashboard() {
  const { sessionToken } = useParams<{ sessionToken: string }>();
  const [session, setSession] = useState<MatchSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sessionToken) return;
      const { data } = await supabase.rpc('get_match_session', { p_token: sessionToken });
      if (!cancelled) {
        setSession(data as MatchSession | null);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-pr-cream text-pr-black-soft">Chargement…</div>;
  }

  if (!session?.success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pr-cream p-4">
        <div className="max-w-sm rounded-2xl border border-pr-stone bg-white p-8 text-center">
          <p className="mb-2 text-3xl">⏳</p>
          <h2 className="text-lg font-medium">Session expirée</h2>
          <p className="mt-1 text-sm text-pr-black-soft/50">Demandez un nouveau lien à l'équipe stade.</p>
        </div>
      </div>
    );
  }

  const sections: { icon: string; title: string; desc: string }[] = [
    { icon: '📄', title: 'Feuille de route', desc: 'Dotations prévues pour votre espace' },
    { icon: '📦', title: 'Stocks', desc: 'Saisir stock initial, réassort et final' },
    { icon: '🕐', title: 'Horaires', desc: 'Confirmer vos heures d’arrivée / départ' },
    { icon: '📝', title: 'Débrief', desc: 'Retour de fin de match' },
  ];

  return (
    <div className="min-h-screen bg-pr-cream">
      <header className="flex items-center gap-3 bg-pr-black px-4 py-3 text-white">
        <span className="font-display text-lg font-black">PR</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{session.event_name}</p>
          <p className="truncate text-xs text-white/60">
            {session.space_name} · {session.staff_name}
          </p>
        </div>
        {session.service_type === 'vip' && (
          <span className="ml-auto rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200">VIP</span>
        )}
        {session.service_type === 'buvette' && (
          <span className="ml-auto rounded-full bg-sky-400/20 px-2 py-0.5 text-xs text-sky-200">Buvette</span>
        )}
      </header>

      <div className="p-4">
        <div className="mb-4 rounded-xl border border-pr-stone bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-pr-black-soft/40">Votre poste</p>
          <p className="mt-1 font-display text-xl font-black text-pr-black">{session.space_name}</p>
          <p className="text-sm text-pr-black-soft/60">
            {session.staff_name} · {frDate(session.event_date)}
          </p>
        </div>

        <div className="space-y-3">
          {sections.map((s) => (
            <div key={s.title} className="flex items-center gap-3 rounded-xl border border-pr-stone bg-white p-4">
              <span className="text-2xl">{s.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-pr-black">{s.title}</p>
                <p className="text-xs text-pr-black-soft/50">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-pr-black-soft/40">
          Connecté en tant que {session.staff_name} — vos horaires sont enregistrés automatiquement.
        </p>
      </div>
    </div>
  );
}
