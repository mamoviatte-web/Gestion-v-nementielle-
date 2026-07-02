/**
 * Bandeau d'alerte persistant (toutes pages admin) : visible dès qu'un produit
 * est en rupture/critique pendant qu'un événement est en cours.
 */

import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useCriticalStatus } from '@/hooks/useDashboardLive';

export function AlertBanner() {
  const { data } = useCriticalStatus();
  const critical = data?.criticalAlerts ?? 0;
  const active = data?.activeEvents ?? 0;
  if (critical === 0 || active === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 md:px-8">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        {critical} produit(s) sous le seuil pendant un événement en cours.
      </span>
      <Link to="/admin/stock" className="font-medium underline">
        Gérer les stocks →
      </Link>
    </div>
  );
}
