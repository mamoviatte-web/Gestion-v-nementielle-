/**
 * RhMatchPage (ROLE_STADE) — « RH Match » : poste de travail opérationnel d'un
 * match, regroupant en un seul écran à onglets les trois modules RH existants,
 * sans toucher à leurs écritures :
 *   • Poste       → RhWorkstationPage (émargement, planning agent, validation J-1→live)
 *   • Planning    → HRPreplanPage (préparation par famille + verrouillage zones)
 *   • Populations → RhPopulationsPage (registre inter-matchs par pôle)
 *
 * L'onglet actif est porté par `?vue=` ; l'événement par `:eventId` (deep link).
 * Route : /admin/rh/match(/:eventId). Les anciennes URLs (poste/preplan/populations)
 * redirigent ici — aucun lien de création n'est perdu.
 */

import { lazy, Suspense } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClipboardList, CalendarRange, Users } from 'lucide-react';

const RhWorkstationPage = lazy(() => import('@/pages/admin/RhWorkstationPage'));
const HRPreplanPage = lazy(() => import('@/pages/admin/HRPreplanPage'));
const RhPopulationsPage = lazy(() => import('@/pages/admin/RhPopulationsPage'));

type Vue = 'poste' | 'planning' | 'populations';
const TABS: { key: Vue; label: string; icon: typeof ClipboardList }[] = [
  { key: 'poste', label: 'Poste de travail', icon: ClipboardList },
  { key: 'planning', label: 'Planning', icon: CalendarRange },
  { key: 'populations', label: 'Populations', icon: Users },
];

export default function RhMatchPage() {
  const [params, setParams] = useSearchParams();
  const { eventId } = useParams<{ eventId?: string }>();
  const navigate = useNavigate();
  const vue = (params.get('vue') as Vue) || 'poste';

  function pick(v: Vue) {
    if (v === 'poste' && eventId) { navigate(`/admin/rh/match/${eventId}?vue=poste`); return; }
    const next = new URLSearchParams(params);
    next.set('vue', v);
    setParams(next, { replace: false });
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="h-8 w-1.5 rounded-full bg-emerald-500" />
        <div>
          <h1 className="text-2xl font-black text-stone-900">RH Match</h1>
          <p className="text-sm text-stone-400">Staffer un match : émargement, planning, populations, validation.</p>
        </div>
      </div>

      {/* Onglets */}
      <div className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-stone-100 bg-stone-50 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === vue;
          return (
            <button key={t.key} onClick={() => pick(t.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                active ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}>
              <Icon size={15} />{t.label}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-stone-100" />}>
        {vue === 'poste' && <RhWorkstationPage basePath="/admin/rh/match" />}
        {vue === 'planning' && <HRPreplanPage />}
        {vue === 'populations' && <RhPopulationsPage />}
      </Suspense>
    </div>
  );
}
