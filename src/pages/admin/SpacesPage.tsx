import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui';
import { Building2 } from 'lucide-react';

export default function SpacesPage() {
  return (
    <div>
      <PageHeader
        title="Espaces"
        description="Les 16 espaces du stade et leurs codes d'accès."
      />
      <EmptyState
        icon={Building2}
        title="Gestion des espaces"
        message="La gestion des espaces sera disponible dans une phase ultérieure."
      />
    </div>
  );
}
