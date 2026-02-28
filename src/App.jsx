import { Suspense, lazy } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { ThemeProvider } from './contexts/ThemeContext';

// Lazy-loaded pages
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
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

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/signup',
    element: <SignupPage />
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
    path: '/workspace/:workspaceId',
    element: protectedLayoutWithWorkspace,
    children: [
      {
        index: true,
        element: <WorkspacePage />
      },
      {
        path: 'settings',
        element: <WorkspaceSettingsPage />
      },
      {
        path: 'dictionaries',
        element: <DictionariesPage />
      }
    ]
  },
  {
    path: '/operations',
    element: protectedLayoutWithWorkspace,
    children: [
      {
        index: true,
        element: <OperationPage />
      }
    ]
  },
  {
    path: '/analytics',
    element: protectedLayoutWithWorkspace,
    children: [
      {
        index: true,
        element: <AnalyticsPage />
      }
    ]
  },
  {
    path: '/scheduled',
    element: protectedLayoutWithWorkspace,
    children: [
      {
        index: true,
        element: <ScheduledPage />
      }
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
])

function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
        <Suspense fallback={<LoadingFallback />}>
          <RouterProvider router={router} />
        </Suspense>
      </div>
    </ThemeProvider>
  )
}

export default App
