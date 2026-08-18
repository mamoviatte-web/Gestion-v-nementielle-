/**
 * AnalysesHubPage — « Analyses » : fusion Analyses + Contrôle de charges en
 * sous-onglets d'UNE page. On REMONTE les composants existants ; aucun recalcul
 * séparé des charges (chaque écran lit sa même source : event_stock_summary,
 * consumption_*, events.total_*). L'onglet est porté par `?tab=` (deep-link +
 * redirection de l'ancienne route /analytics/costs).
 */

import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { TrendingUp, Wallet } from 'lucide-react';
import AnalyticsPage from '@/pages/admin/AnalyticsPage';
import CostControlPage from '@/pages/admin/CostControlPage';

const TABS = [
  { key: 'overview', label: "Vue d'ensemble", icon: TrendingUp },
  { key: 'charges', label: 'Charges', icon: Wallet },
] as const;

export default function AnalysesHubPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'charges' ? 'charges' : 'overview';

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap gap-1 border-b border-stone-200">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setParams(t.key === 'overview' ? {} : { tab: t.key }, { replace: true })}
                className={clsx(
                  '-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
                  active ? 'border-pr-olive text-pr-olive' : 'border-transparent text-stone-500 hover:text-stone-700',
                )}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {tab === 'charges' ? <CostControlPage /> : <AnalyticsPage />}
    </div>
  );
}
