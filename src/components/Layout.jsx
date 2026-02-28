import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Menu, X, Home, Settings, BarChart3, Calendar, CreditCard, LogOut, BookOpen, Sun, Moon, Receipt } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { usePermissions } from '../hooks/usePermissions'
import { useTheme } from '../contexts/ThemeContext'
import WorkspaceSwitcher from './WorkspaceSwitcher'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, logout } = useAuth()
  const { currentWorkspace, loading: workspaceLoading, workspaceId } = useWorkspace()
  const { canViewWorkspaceSettings } = usePermissions()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen)

  const menuItems = [
    { icon: Home, label: 'Главная', path: workspaceId ? `/workspace/${workspaceId}` : '/', matchPath: `/workspace/${workspaceId}` },
    { icon: CreditCard, label: 'Операции', path: workspaceId ? `/operations?workspaceId=${workspaceId}` : '/operations', matchPath: '/operations' },
    { icon: Calendar, label: 'Запланированные', path: workspaceId ? `/scheduled?workspaceId=${workspaceId}` : '/scheduled', matchPath: '/scheduled' },
    { icon: Receipt, label: 'Долги', path: workspaceId ? `/debts?workspaceId=${workspaceId}` : '/debts', matchPath: '/debts' },
    { icon: BarChart3, label: 'Аналитика', path: workspaceId ? `/analytics?workspaceId=${workspaceId}` : '/analytics', matchPath: '/analytics' },
    { icon: BookOpen, label: 'Справочники', path: workspaceId ? `/workspace/${workspaceId}/dictionaries` : '/dictionaries', matchPath: '/dictionaries' },
    ...(canViewWorkspaceSettings ? [{
      icon: Settings,
      label: 'Настройки',
      path: workspaceId ? `/workspace/${workspaceId}/settings` : '/settings',
      matchPath: '/settings'
    }] : []),
  ]

  const isActive = (item) => {
    const pathname = location.pathname
    if (item.matchPath === `/workspace/${workspaceId}`) {
      return pathname === `/workspace/${workspaceId}`
    }
    return pathname.startsWith(item.matchPath)
  }

  const SidebarContent = () => (
    <>
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex-1">
          <h2 className="text-lg font-bold text-primary-600 dark:text-primary-400 mb-3">ФинУчёт</h2>
          <WorkspaceSwitcher />
        </div>
        <button onClick={toggleSidebar} className="p-1 lg:hidden">
          <X size={24} className="text-gray-600 dark:text-gray-400" />
        </button>
      </div>
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  onClick={() => sidebarOpen && toggleSidebar()}
                  className={`flex items-center space-x-3 py-2.5 px-3 rounded-xl transition-all duration-200 ${
                    active
                      ? 'bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-medium shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon size={20} className={active ? 'text-primary-600 dark:text-primary-400' : ''} />
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 w-full py-2 px-3 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          <span>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
        </button>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{user ? user.name : 'Гость'}</span>
            <div className="text-xs text-gray-500 dark:text-gray-500">{user ? user.email : ''}</div>
          </div>
          <button onClick={logout} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Выйти">
            <LogOut size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>
      </div>
    </>
  );

  const pageBg = currentWorkspace?.is_personal
    ? 'bg-amber-50 dark:bg-gray-900'
    : 'bg-gray-50 dark:bg-gray-900'

  return (
    <div className={`flex min-h-screen ${pageBg} transition-colors duration-300`}>
      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" aria-hidden="true" onClick={toggleSidebar}></div>
          <div className="relative flex flex-col w-64 h-full bg-white dark:bg-gray-900 shadow-xl">
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:z-10 glass border-r border-gray-200 dark:border-gray-700 shadow-md">
        <SidebarContent />
      </div>

      <div className="flex-1 flex flex-col lg:pl-64">
        {/* Mobile Header */}
        <header className="glass border-b border-gray-200 dark:border-gray-700 px-4 py-3 sticky top-0 z-30 lg:hidden shadow-sm">
          <div className="flex items-center justify-between">
            <button onClick={toggleSidebar} className="p-1">
              <Menu size={24} className="text-gray-600 dark:text-gray-400" />
            </button>
            <div className="flex-1 mx-4">
              <WorkspaceSwitcher />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {theme === 'dark' ? <Sun size={18} className="text-gray-400" /> : <Moon size={18} className="text-gray-600" />}
              </button>
              <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center shadow-sm">
                <span className="text-white text-sm font-medium">
                  {user?.email?.charAt(0).toUpperCase() || 'П'}
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
