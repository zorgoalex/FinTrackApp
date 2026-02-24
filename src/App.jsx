import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import ComingSoonPage from './pages/ComingSoonPage';
import WorkspaceSelectPage from './pages/WorkspaceSelectPage';
import WorkspaceCreatePage from './pages/WorkspaceCreatePage';
import WorkspacePage from './pages/WorkspacePage';
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage';
import { OperationPage } from './pages/OperationPage';
import AnalyticsPage from './pages/AnalyticsPage';
import LoginPage from './pages/LoginPage';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import SignupPage from './pages/SignupPage';
import InvitationAcceptPage from './pages/InvitationAcceptPage';
import { WorkspaceProvider } from './contexts/WorkspaceContext';

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
      <RouterProvider router={router} />
    </div>
  )
}

export default App
