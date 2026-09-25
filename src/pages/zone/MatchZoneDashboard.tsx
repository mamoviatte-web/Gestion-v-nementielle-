/**
 * MatchZoneDashboard — accueil responsable de zone (match, flux token).
 * Cartes CLIQUABLES vers les 4 sections + statut de complétion.
 * Route : /zone/match/:sessionToken
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useMatchSession } from '@/hooks/useMatchSession';
import { MatchZoneHeader } from '@/components/zone/MatchZoneHeader';
import { PETIT_MATERIEL_ENABLED } from '@/lib/featureFlags';

type Status = 'todo' | 'in_progress' | 'done';

function frDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

const STATUS_CFG: Record<Status, { border: string; badge: string | null }> = {
  todo: { border: 'border-pr-stone', badge: null },
  in_progress: { border: 'border-amber-300 bg-amber-50', badge: '🔄 En cours' },
  done: { border: 'border-green-300 bg-green-50', badge: '✅ Complété' },
};

export default function MatchZoneDashboard() {
  const { token, session, loading } = useMatchSession();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [nbBuvettes, setNbBuvettes] = useState(0);

  useEffect(() => {
    if (!token || !session?.success) return;
    void supabase.rpc('get_zone_status', { p_token: token }).then(({ data }) => {
      const r = data as { success?: boolean; stocks?: Status; schedules?: Status; debrief?: Status } | null;
      if (r?.success) setStatus({ stocks: r.stocks ?? 'todo', schedules: r.schedules ?? 'todo', debrief: r.debrief ?? 'todo' });
    });
    // Superviseur buvettes ? get_zone_buvettes renvoie le pool B1…B9 (vide sinon).
    void supabase.rpc('get_zone_buvettes', { p_token: token }).then(({ data }) => {
      const r = data as { success?: boolean; all_buvettes?: unknown[] } | null;
      if (r?.success) setNbBuvettes(r.all_buvettes?.length ?? 0);
    });
  }, [token, session]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-pr-cream text-pr-black-soft/50">Chargement…</div>;
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

  const cards: { icon: string; title: string; subtitle: string; path: string; status?: Status }[] = [
    ...(nbBuvettes > 0
      ? [{ icon: '🍺', title: 'Gérer mes buvettes', subtitle: 'Stocks & pointage des buvettes', path: 'buvettes' }]
      : []),
    ...(session.space_name === 'Terrasses'
      ? [{ icon: '🌿', title: 'Terrasses VIP', subtitle: 'Sous-zones T2→T5 activées pour ce match', path: 'terrasses' }]
      : []),
    { icon: '📋', title: 'Feuille de route', subtitle: 'Dotations prévues pour votre espace', path: 'roadmap' },
    { icon: '📦', title: 'Stocks', subtitle: 'Saisir stock initial, réassort et final', path: 'stocks', status: status.stocks },
    { icon: '⏱', title: 'Horaires de l\'équipe', subtitle: 'Recenser vos agents et leurs heures réelles', path: 'rh', status: status.schedules },
    { icon: '📝', title: 'Débrief', subtitle: "Retour de fin d'événement + photos", path: 'debrief', status: status.debrief },
    ...(PETIT_MATERIEL_ENABLED
      ? [{ icon: '🧰', title: 'Besoins petit matériel', subtitle: 'Gobelets, couverts, consommables pour le prochain match', path: 'materiel' }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-pr-cream">
      <MatchZoneHeader session={session} />
      <div className="mx-auto max-w-lg space-y-3 p-4">
        <div className="rounded-xl border border-pr-stone bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-pr-black-soft/45">Votre poste</p>
          <p className="mt-1 font-display text-xl font-black text-pr-black">{session.space_name}</p>
          <p className="text-sm text-pr-black-soft/50">
            {session.staff_name} · {frDate(session.event_date)}
          </p>
        </div>

        {cards.map((c) => {
          const cfg = STATUS_CFG[c.status ?? 'todo'];
          return (
            <button
              key={c.path}
              type="button"
              onClick={() => navigate(`/zone/match/${token}/${c.path}`)}
              className={`flex min-h-[72px] w-full items-center gap-4 rounded-xl border-2 bg-white p-4 text-left transition-transform active:scale-95 ${cfg.border}`}
            >
              <span className="text-3xl">{c.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-pr-black">{c.title}</p>
                <p className="mt-0.5 text-sm text-pr-black-soft/50">{c.subtitle}</p>
              </div>
              {cfg.badge && <span className="whitespace-nowrap text-xs font-medium">{cfg.badge}</span>}
              <span className="text-lg text-pr-black-soft/30">›</span>
            </button>
          );
        })}

        <p className="pt-2 text-center text-xs text-pr-black-soft/45">
          Connecté en tant que {session.staff_name} — vos saisies sont transmises à l'équipe stade.
        </p>
      </div>
    </div>
  );
}
