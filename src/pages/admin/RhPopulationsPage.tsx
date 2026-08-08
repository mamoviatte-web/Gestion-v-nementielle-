/**
 * RhPopulationsPage — registre inter-matchs des populations RH (ROLE_STADE).
 */

import { PageHeader } from '@/components/layout/PageHeader';
import { RhPopulationsPanel } from '@/components/rh/RhPopulationsPanel';

export default function RhPopulationsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Populations RH"
        description="Agrégation sur tous les matchs : récurrence et heures cumulées par pôle."
      />
      <RhPopulationsPanel />
    </div>
  );
}
