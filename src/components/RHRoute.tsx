/**
 * RHRoute — garde de route pour l'interface Responsable RH (accès par code RH,
 * session locale dans localStorage). Redirige vers /login si aucun token.
 */

import { Navigate } from 'react-router-dom';

export function RHRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('rh_session_token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
