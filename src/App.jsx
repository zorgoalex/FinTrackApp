import { Suspense, lazy } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { WorkspaceProvider } from './contexts/WorkspaceContext';

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
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<LoadingFallback />}>
        <RouterProvider router={router} />
      </Suspense>
    </div>
  )
}

export default App
