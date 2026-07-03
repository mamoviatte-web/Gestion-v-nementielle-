/**
 * StockPage — module Stock CDC V2 (ROLE_STADE).
 * 5 onglets : Vue générale · Par espace · Mouvements · Inventaire · Rapports.
 */

import { useState } from 'react';
import { BarChart3, Building2, ArrowLeftRight, ClipboardList, FileDown, Warehouse, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader } from '@/components/layout/PageHeader';
import StockDashboard from './StockDashboard';
import StockBySpace from './StockBySpace';
import StockMovements from './StockMovements';
import StockInventory from './StockInventory';
import StockReports from './StockReports';
import DepotsTab from './DepotsTab';

type StockTabKey = 'general' | 'depots' | 'espace' | 'mouvements' | 'inventaire' | 'rapports';

const TABS: { key: StockTabKey; label: string; Icon: LucideIcon }[] = [
  { key: 'general', label: 'Vue générale', Icon: BarChart3 },
  { key: 'depots', label: 'Dépôts', Icon: Warehouse },
  { key: 'espace', label: 'Par espace', Icon: Building2 },
  { key: 'mouvements', label: 'Mouvements', Icon: ArrowLeftRight },
  { key: 'inventaire', label: 'Inventaire', Icon: ClipboardList },
  { key: 'rapports', label: 'Rapports', Icon: FileDown },
];

export default function StockPage() {
  const [tab, setTab] = useState<StockTabKey>('general');

  return (
    <div>
      <PageHeader
        title="Stocks"
        description="Registre localisé des mouvements et soldes — réserve, espaces, inventaires."
      />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-pr-stone">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-pr-black text-pr-black'
                  : 'border-transparent text-pr-black-soft/50 hover:text-pr-black',
              )}
            >
              <t.Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'general' && <StockDashboard />}
      {tab === 'depots' && <DepotsTab />}
      {tab === 'espace' && <StockBySpace />}
      {tab === 'mouvements' && <StockMovements />}
      {tab === 'inventaire' && <StockInventory />}
      {tab === 'rapports' && <StockReports />}
    </div>
  );
}
