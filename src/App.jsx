import { Suspense, lazy } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { ThemeProvider } from './contexts/ThemeContext';
import AppErrorBoundary, { RouteErrorBoundary } from './components/AppErrorBoundary';

// Lazy-loaded pages
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const ComingSoonPage = lazy(() => import('./pages/ComingSoonPage'));
const WorkspaceSelectPage = lazy(() => import('./pages/WorkspaceSelectPage'));
const WorkspaceCreatePage = lazy(() => import('./pages/WorkspaceCreatePage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const WorkspaceSettingsPage = lazy(() => import('./pages/WorkspaceSettingsPage'));
const OperationPage = lazy(() => import('./pages/OperationPage').then(m => ({ default: m.OperationPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const DictionariesPage = lazy(() => import('./pages/DictionariesPage'));
const ScheduledPage = lazy(() => import('./pages/ScheduledPage'));
const InvitationAcceptPage = lazy(() => import('./pages/InvitationAcceptPage'));
const DebtsPage = lazy(() => import('./pages/DebtsPage'));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage'));
const AssistantPage = lazy(() => import('./pages/AssistantPage'));
const CashflowPage = lazy(() => import('./pages/CashflowPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
      </div>
    </div>
  );
}

const protectedLayoutWithWorkspace = (
  <ProtectedRoute>
    <WorkspaceProvider>
      <Layout />
    </WorkspaceProvider>
  </ProtectedRoute>
);

const router = createBrowserRouter([{
  errorElement: <RouteErrorBoundary />,
  children: [
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/signup',
    element: <SignupPage />
  },
  {
    path: '/forgot-password',
    element: <ForgotPasswordPage />
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />
  },
  {
    path: '/legal',
    element: <LegalPage />
  },
  {
    path: '/accept-invitation',
    element: <ProtectedRoute><InvitationAcceptPage /></ProtectedRoute>
  },
  {
    path: '/workspaces',
    element: <ProtectedRoute><WorkspaceSelectPage /></ProtectedRoute>
  },
  {
    path: '/workspaces/create',
    element: <ProtectedRoute><WorkspaceCreatePage /></ProtectedRoute>
  },
  {
    element: protectedLayoutWithWorkspace,
    children: [
      { path: '/workspace/:workspaceId', element: <WorkspacePage /> },
      { path: '/workspace/:workspaceId/settings', element: <WorkspaceSettingsPage /> },
      { path: '/workspace/:workspaceId/dictionaries', element: <DictionariesPage /> },
      { path: '/operations', element: <OperationPage /> },
      { path: '/analytics', element: <AnalyticsPage /> },
      { path: '/debts', element: <DebtsPage /> },
      { path: '/budgets', element: <BudgetsPage /> },
      { path: '/scheduled', element: <ScheduledPage /> },
      { path: '/cashflow', element: <CashflowPage /> },
      { path: '/assistant', element: <AssistantPage /> },
      { path: '/profile', element: <ProfilePage /> },
    ]
  },
  {
    path: '/',
    element: <ProtectedRoute><Navigate to="/workspaces" replace /></ProtectedRoute>
  },
  {
    path: '*',
    element: <ComingSoonPage />
  }
  ]
}])

function App() {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
          <Suspense fallback={<LoadingFallback />}>
            <RouterProvider router={router} future={{ v7_startTransition: true }} />
          </Suspense>
        </div>
      </ThemeProvider>
    </AppErrorBoundary>
  )
}

export default App
