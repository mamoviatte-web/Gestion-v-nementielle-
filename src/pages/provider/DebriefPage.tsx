import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui';
import { MessageSquare } from 'lucide-react';

export default function DebriefPage() {
  return (
    <div>
      <PageHeader
        title="Débrief"
        description="Compte-rendu de fin d'événement."
      />
      <EmptyState
        icon={MessageSquare}
        title="Débrief"
        message="Le formulaire de débrief sera disponible dans une phase ultérieure."
      />
    </div>
  );
}
