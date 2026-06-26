/**
 * ProviderHomePage — saisie du nom du responsable (RG-001).
 *
 * Tant que le nom n'est pas renseigné, le responsable ne peut pas accéder
 * aux onglets Stocks / Horaires / Débrief. Une fois saisi, il est mémorisé
 * pour la session et l'utilisateur est dirigé vers la saisie de stock.
 */

import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { UserCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button, Input } from '@/components/ui';

export default function ProviderHomePage() {
  const { user, responsableName, setResponsableName } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(responsableName ?? '');
  const [error, setError] = useState<string | null>(null);

  // Si le nom est déjà renseigné, on passe directement aux stocks.
  if (responsableName) {
    return <Navigate to="/provider/stock" replace />;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Merci d\'indiquer votre nom (au moins 2 caractères).');
      return;
    }
    setResponsableName(trimmed);
    navigate('/provider/stock', { replace: true });
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center pt-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-provence/10 text-provence">
        <UserCircle2 className="h-9 w-9" />
      </div>
      <h1 className="mt-4 text-lg font-bold text-slate-900">
        Bienvenue sur l'espace {user?.spaceCode}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Avant de commencer, merci d'indiquer votre nom. Il sera associé à vos
        saisies.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 w-full space-y-4 text-left">
        <Input
          label="Votre nom"
          name="responsableName"
          placeholder="Ex : Jean Dupont"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={error}
          autoFocus
          required
        />
        <Button type="submit" fullWidth size="lg">
          Commencer
        </Button>
      </form>
    </div>
  );
}
