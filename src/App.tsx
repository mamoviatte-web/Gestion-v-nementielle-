/**
 * App — routing applicatif avec protection par rôle (CDC V1.1).
 *
 *   /                  → redirige selon le rôle connecté
 *   /login             → LoginPage (public)
 *   /admin/*           → AdminLayout (ROLE_STADE)
 *   /provider/*        → ProviderLayout (ROLE_RESPONSABLE)
 */

import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { RequireResponsableName } from '@/components/RequireResponsableName';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ProviderLayout } from '@/components/layout/ProviderLayout';
import { Spinner } from '@/components/ui';

import LoginPage from '@/pages/auth/LoginPage';
import DashboardPage from '@/pages/admin/DashboardPage';
import EventsPage from '@/pages/admin/EventsPage';
import EventDetailPage from '@/pages/admin/EventDetailPage';
import CatalogPage from '@/pages/admin/CatalogPage';
import SpacesPage from '@/pages/admin/SpacesPage';
import ExportPage from '@/pages/admin/ExportPage';
import ProviderHomePage from '@/pages/provider/ProviderHomePage';
import StockEntryPage from '@/pages/provider/StockEntryPage';
import SchedulePage from '@/pages/provider/SchedulePage';
import DebriefPage from '@/pages/provider/DebriefPage';

/** Redirection de la racine selon l'état d'authentification et le rôle. */
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner fullPage label="Chargement…" />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Navigate
      to={user.role === 'ROLE_STADE' ? '/admin/dashboard' : '/provider/home'}
      replace
    />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Espace Stade (ROLE_STADE) */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute role="ROLE_STADE">
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="spaces" element={<SpacesPage />} />
        <Route path="export" element={<ExportPage />} />
      </Route>

      {/* Espace Responsable (ROLE_RESPONSABLE) */}
      <Route
        path="/provider"
        element={
          <ProtectedRoute role="ROLE_RESPONSABLE">
            <ProviderLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<ProviderHomePage />} />
        <Route
          path="stock"
          element={
            <RequireResponsableName>
              <StockEntryPage />
            </RequireResponsableName>
          }
        />
        <Route
          path="schedule"
          element={
            <RequireResponsableName>
              <SchedulePage />
            </RequireResponsableName>
          }
        />
        <Route
          path="debrief"
          element={
            <RequireResponsableName>
              <DebriefPage />
            </RequireResponsableName>
          }
        />
      </Route>

      {/* Repli */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
