import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui';
import type { UserRole } from '@/lib/types';

interface ProtectedRouteProps {
  role: UserRole;
  children: ReactNode;
}

/**
 * Protège une branche de routes par rôle.
 * - Non connecté → redirige vers /login.
 * - Mauvais rôle → redirige vers l'accueil de son propre rôle.
 */
export function ProtectedRoute({ role, children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Spinner fullPage label="Chargement…" />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.role !== role) {
    const home =
      user.role === 'ROLE_STADE' ? '/admin/dashboard' : '/provider/home';
    return <Navigate to={home} replace />;
  }

  return <>{children}</>;
}
