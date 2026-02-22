import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import WorkspaceSelectPage from './pages/WorkspaceSelectPage';
import WorkspaceCreatePage from './pages/WorkspaceCreatePage';
import WorkspacePage from './pages/WorkspacePage';
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage';
import LoginPage from './pages/LoginPage';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import SignupPage from './pages/SignupPage';
import InvitationAcceptPage from './pages/InvitationAcceptPage';
import InvitationHistoryPage from './pages/InvitationHistoryPage';
import { WorkspaceProvider } from './contexts/WorkspaceContext';

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
    element: <ProtectedRoute><WorkspaceProvider><Layout /></WorkspaceProvider></ProtectedRoute>,
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
          path: 'settings/invites/history',
          element: <InvitationHistoryPage />
        }
      ]
  },
  {
    path: '/',
    element: <ProtectedRoute><Layout /></ProtectedRoute>,
    children: [
      {
        index: true,
        element: <Navigate to="/workspaces" replace />
      }
    ]
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