import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui';
import { CalendarDays } from 'lucide-react';

export default function EventsPage() {
  return (
    <div>
      <PageHeader
        title="Événements"
        description="Gestion des matchs, séminaires et privatisations."
      />
      <EmptyState
        icon={CalendarDays}
        title="Aucun événement à afficher"
        message="La gestion des événements sera disponible dans une phase ultérieure."
      />
    </div>
  );
}
