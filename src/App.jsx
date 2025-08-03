import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/',
    element: <ProtectedRoute><Layout /></ProtectedRoute>,
    children: [
      {
        index: true,
        element: <HomePage />
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
