import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui';
import { Package } from 'lucide-react';

export default function CatalogPage() {
  return (
    <div>
      <PageHeader
        title="Catalogue"
        description="Produits et prix HT de référence."
      />
      <EmptyState
        icon={Package}
        title="Catalogue produits"
        message="La gestion du catalogue sera disponible dans une phase ultérieure."
      />
    </div>
  );
}
