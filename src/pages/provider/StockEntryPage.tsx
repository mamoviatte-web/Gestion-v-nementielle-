import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui';
import { Boxes } from 'lucide-react';

export default function StockEntryPage() {
  return (
    <div>
      <PageHeader
        title="Saisie des stocks"
        description="Ouverture, réassort et clôture."
      />
      <EmptyState
        icon={Boxes}
        title="Saisie de stock"
        message="Le formulaire de saisie de stock sera disponible dans une phase ultérieure."
      />
    </div>
  );
}
