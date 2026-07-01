/**
 * App — routing applicatif avec protection par rôle (CDC V1.1).
 *
 *   /                  → redirige selon le rôle connecté
 *   /login             → LoginPage (public)
 *   /admin/*           → AdminLayout (ROLE_STADE)
 *   /provider/*        → ProviderLayout (ROLE_RESPONSABLE)
 *
 * Les pages sont chargées en lazy (code-splitting) pour alléger le bundle.
 */

import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { RequireResponsableName } from '@/components/RequireResponsableName';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ProviderLayout } from '@/components/layout/ProviderLayout';
import { Logo } from '@/components/ui';

/** Écran de chargement de marque (rameau en fondu). */
function BrandLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-pr-cream">
      <Logo variant="mark" size="lg" className="animate-pr-fade" />
    </div>
  );
}

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/admin/DashboardPage'));
const EventsPage = lazy(() => import('@/pages/admin/EventsPage'));
const EventDetailPage = lazy(() => import('@/pages/admin/EventDetailPage'));
const CatalogPage = lazy(() => import('@/pages/admin/CatalogPage'));
const StockPage = lazy(() => import('@/pages/admin/stock/StockPage'));
const AnalyticsPage = lazy(() => import('@/pages/admin/AnalyticsPage'));
const StaffAnalyticsPage = lazy(() => import('@/pages/admin/StaffAnalyticsPage'));
const SpacesPage = lazy(() => import('@/pages/admin/SpacesPage'));
const ExportPage = lazy(() => import('@/pages/admin/ExportPage'));
const RunnerSpaceDetail = lazy(() => import('@/pages/admin/RunnerSpaceDetail'));
const ProviderHomePage = lazy(() => import('@/pages/provider/ProviderHomePage'));
const StockEntryPage = lazy(() => import('@/pages/provider/StockEntryPage'));
const SchedulePage = lazy(() => import('@/pages/provider/SchedulePage'));
const DebriefPage = lazy(() => import('@/pages/provider/DebriefPage'));
const RunnerTerrainView = lazy(() => import('@/pages/runner/RunnerTerrainView'));
const ZoneEntryPage = lazy(() => import('@/pages/zone/ZoneEntryPage'));
const ZoneDashboard = lazy(() => import('@/pages/zone/ZoneDashboard'));

/** Redirection de la racine selon l'état d'authentification et le rôle. */
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <BrandLoader />;
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
    <Suspense fallback={<BrandLoader />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Vue terrain runner publique (par jeton) */}
        <Route path="/runner/:token" element={<RunnerTerrainView />} />
        {/* Zone responsable séminaire — accès public par code (sans compte) */}
        <Route path="/zone/:token" element={<ZoneEntryPage />} />
        <Route path="/zone/:token/dashboard" element={<ZoneDashboard />} />

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
          <Route path="events/:id/runner/:spaceId" element={<RunnerSpaceDetail />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="analytics/staff" element={<StaffAnalyticsPage />} />
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
    </Suspense>
  );
}
