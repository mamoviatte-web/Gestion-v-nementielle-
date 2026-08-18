/**
 * QualityHubPage — « Qualité des données » : fusion Santé des données + AuditPilot
 * en deux sous-onglets d'UNE page (une seule zone qualité, pas deux scores
 * concurrents). On REMONTE les composants existants tels quels ; l'onglet est
 * porté par `?tab=` (deep-link + redirections des anciennes routes).
 */

import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { ShieldCheck, Activity } from 'lucide-react';
import AuditPilotPage from '@/pages/admin/AuditPilotPage';
import DataHealthPage from '@/pages/admin/DataHealthPage';

const TABS = [
  { key: 'audit', label: 'Audit', icon: ShieldCheck },
  { key: 'sante', label: 'Santé', icon: Activity },
] as const;

export default function QualityHubPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'sante' ? 'sante' : 'audit';

  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap gap-1 border-b border-stone-200">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setParams(t.key === 'audit' ? {} : { tab: t.key }, { replace: true })}
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
      {tab === 'audit' ? <AuditPilotPage /> : <DataHealthPage />}
    </div>
  );
}
