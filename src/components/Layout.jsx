import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import { Menu, X, Home, Users, Settings, BarChart3, Calendar, CreditCard, LogOut, Building2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, logout } = useAuth()
  const { currentWorkspace, loading: workspaceLoading } = useWorkspace()
  
  console.log('Layout render:', { currentWorkspace });

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen)

  const menuItems = [
    { icon: Home, label: 'Главная', path: '/' },
    { icon: CreditCard, label: 'Операции', path: '/operations' },
    { icon: Calendar, label: 'Запланированные', path: '/scheduled' },
    { icon: BarChart3, label: 'Аналитика', path: '/analytics' },
    { icon: Users, label: 'Справочники', path: '/directories' },
    { icon: Settings, label: 'Настройки', path: '/settings' },
  ]

  const SidebarContent = () => (
    <>
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">ФинУчёт</h2>
          {currentWorkspace && (
            <div className="flex items-center text-sm text-gray-600 mt-1">
              <Building2 size={14} className="mr-1" />
              <span>{currentWorkspace.name}</span>
              {currentWorkspace.is_personal && (
                <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">Личное</span>
              )}
            </div>
          )}
          {workspaceLoading && (
            <div className="text-sm text-gray-500 mt-1">Загрузка...</div>
          )}
        </div>
        <button onClick={toggleSidebar} className="p-1 lg:hidden">
          <X size={24} className="text-gray-600" />
        </button>
      </div>
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  onClick={() => sidebarOpen && toggleSidebar()}
                  className="flex items-center space-x-3 py-2 px-3 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="p-4 border-t flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-gray-600">{user ? user.name : 'Гость'}</span>
          <div className="text-xs text-gray-500">{user ? user.email : ''}</div>
        </div>
        <button onClick={logout} className="p-1" title="Выйти">
          <LogOut size={20} className="text-gray-600" />
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/30" aria-hidden="true" onClick={toggleSidebar}></div>
          <div className="relative flex flex-col w-64 h-full bg-white shadow-lg">
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:z-10 bg-white border-r border-gray-200">
        <SidebarContent />
      </div>

      <div className="flex-1 flex flex-col lg:pl-64">
        {/* Mobile Header */}
        <header className="bg-white shadow-sm border-b px-4 py-3 sticky top-0 z-30 lg:hidden">
          <div className="flex items-center justify-between">
            <button onClick={toggleSidebar} className="p-1">
              <Menu size={24} className="text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">ФинУчёт</h1>
              {currentWorkspace && (
                <div className="text-sm text-gray-600">{currentWorkspace.name}</div>
              )}
            </div>
            <div className="flex items-center space-x-2">
              {currentWorkspace && (
                <span className="hidden sm:inline text-sm text-gray-600">
                  {currentWorkspace.is_personal ? 'Личное' : 'Общее'}
                </span>
              )}
              <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">
                  {currentWorkspace?.name?.charAt(0) || 'П'}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}