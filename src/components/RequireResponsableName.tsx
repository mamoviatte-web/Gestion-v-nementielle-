import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';

/**
 * Garde-fou RG-001 : interdit l'accès aux onglets Responsable tant que le
 * nom n'a pas été saisi. Redirige vers /provider/home le cas échéant.
 */
export function RequireResponsableName({ children }: { children: ReactNode }) {
  const { responsableName } = useAuth();
  if (!responsableName) {
    return <Navigate to="/provider/home" replace />;
  }
  return <>{children}</>;
}
