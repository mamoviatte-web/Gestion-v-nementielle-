import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui';

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <PageHeader
        title="Détail de l'événement"
        description={`Identifiant : ${id ?? '—'}`}
      />
      <Alert variant="info">
        Le détail de l'événement sera implémenté dans une phase ultérieure.
      </Alert>
    </div>
  );
}
