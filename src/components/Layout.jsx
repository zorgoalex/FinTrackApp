import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { Menu, X, Home, Settings, BarChart3, Calendar, CalendarClock, CreditCard, LogOut, BookOpen, Sun, Moon, Receipt, Target, PlusCircle, MoreHorizontal, Sparkles } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { usePermissions } from '../hooks/usePermissions'
import { useTheme } from '../contexts/ThemeContext'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import NotificationCenter from './NotificationCenter'
import useNotifications from '../hooks/useNotifications'
import { BUILD_LABEL } from '../utils/buildInfo'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, logout } = useAuth()
  const { currentWorkspace, workspaceId } = useWorkspace()
  const { canViewWorkspaceSettings, canCreateOperations } = usePermissions()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const notifications = useNotifications(workspaceId)

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen)

  const menuItems = [
    { icon: Home, label: 'Главная', path: workspaceId ? `/workspace/${workspaceId}` : '/', matchPath: `/workspace/${workspaceId}` },
    { icon: CreditCard, label: 'Операции', path: workspaceId ? `/operations?workspaceId=${workspaceId}` : '/operations', matchPath: '/operations' },
    { icon: Calendar, label: 'Запланированные', path: workspaceId ? `/scheduled?workspaceId=${workspaceId}` : '/scheduled', matchPath: '/scheduled' },
    { icon: CalendarClock, label: 'Платёжный календарь', path: workspaceId ? `/cashflow?workspaceId=${workspaceId}` : '/cashflow', matchPath: '/cashflow' },
    { icon: Receipt, label: 'Долги', path: workspaceId ? `/debts?workspaceId=${workspaceId}` : '/debts', matchPath: '/debts' },
    { icon: Target, label: 'Бюджеты', path: workspaceId ? `/budgets?workspaceId=${workspaceId}` : '/budgets', matchPath: '/budgets' },
    { icon: BarChart3, label: 'Аналитика', path: workspaceId ? `/analytics?workspaceId=${workspaceId}` : '/analytics', matchPath: '/analytics' },
    { icon: Sparkles, label: 'AI-ассистент', path: workspaceId ? `/assistant?workspaceId=${workspaceId}` : '/assistant', matchPath: '/assistant' },
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
        <button onClick={toggleSidebar} className="p-2 lg:hidden" aria-label="Закрыть меню">
          <X size={24} className="text-gray-600 dark:text-gray-400" />
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
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
      <div className="shrink-0 border-t border-gray-200 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] space-y-3 dark:border-gray-700 lg:pb-4">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 w-full py-2 px-3 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          <span>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
        </button>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => { navigate(`/profile${workspaceId ? `?workspaceId=${workspaceId}` : ''}`); if (sidebarOpen) toggleSidebar(); }} className="min-w-0 rounded-lg p-1 text-left hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Открыть личный кабинет">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">{user ? user.name || user.email : 'Гость'}</span>
            <span className="block truncate text-xs text-gray-500 dark:text-gray-500">{user ? user.email : ''}</span>
          </button>
          <button onClick={logout} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Выйти" aria-label="Выйти">
            <LogOut size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>
        <p className="px-3 text-[10px] text-gray-400 dark:text-gray-600" data-testid="build-version">Версия {BUILD_LABEL}</p>
      </div>
    </>
  );

  const pageBg = currentWorkspace?.workspace_type === 'personal'
    ? 'bg-amber-50 dark:bg-gray-900'
    : 'bg-gray-50 dark:bg-gray-900'

  return (
    <div className={`flex min-h-screen overflow-x-hidden ${pageBg} transition-colors duration-300`}>
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

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Mobile Header */}
        <header className="glass border-b border-gray-200 dark:border-gray-700 px-4 py-3 sticky top-0 z-30 lg:hidden shadow-sm">
          <div className="flex items-center justify-between">
            <button onClick={toggleSidebar} className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Открыть меню">
              <Menu size={24} className="text-gray-600 dark:text-gray-400" />
            </button>
            <div className="flex-1 min-w-0 mx-2 sm:mx-4">
              <WorkspaceSwitcher />
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <div id="page-header-actions" className="flex items-center gap-1"></div>
              <NotificationCenter notifications={notifications} />
              <button
                onClick={toggleTheme}
                className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              >
                {theme === 'dark' ? <Sun size={18} className="text-gray-400" /> : <Moon size={18} className="text-gray-600" />}
              </button>
              <button type="button" onClick={() => navigate(`/profile${workspaceId ? `?workspaceId=${workspaceId}` : ''}`)} className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm ring-offset-2 hover:ring-2 hover:ring-primary-300" aria-label="Открыть личный кабинет">
                <span className="text-white text-sm font-medium">
                  {user?.email?.charAt(0).toUpperCase() || 'П'}
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>

        {workspaceId && <div className="fixed right-5 top-4 z-30 hidden lg:block"><NotificationCenter notifications={notifications} /></div>}

        {workspaceId && (
          <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-gray-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur-xl dark:border-gray-700 dark:bg-gray-900/95 lg:hidden" aria-label="Основная навигация">
            <MobileNavLink to={`/workspace/${workspaceId}`} active={location.pathname === `/workspace/${workspaceId}`} icon={Home} label="Главная" />
            <MobileNavLink to={`/operations?workspaceId=${workspaceId}`} active={location.pathname.startsWith('/operations')} icon={CreditCard} label="Операции" />
            <button
              type="button"
              onClick={() => navigate(`/operations?workspaceId=${workspaceId}&new=expense`)}
              disabled={!canCreateOperations}
              className="flex min-h-12 flex-col items-center justify-center gap-0.5 text-primary-600 disabled:opacity-40 dark:text-primary-400"
              aria-label="Добавить расход"
            >
              <PlusCircle size={30} strokeWidth={2.2} />
              <span className="text-[10px] font-medium">Добавить</span>
            </button>
            <MobileNavLink to={`/budgets?workspaceId=${workspaceId}`} active={location.pathname.startsWith('/budgets')} icon={Target} label="Бюджеты" />
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex min-h-12 flex-col items-center justify-center gap-0.5 text-gray-500 dark:text-gray-400"
              aria-label="Открыть остальные разделы"
            >
              <MoreHorizontal size={21} />
              <span className="text-[10px] font-medium">Ещё</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}

function MobileNavLink({ to, active, icon: Icon, label }) {
  return (
    <Link
      to={to}
      className={`flex min-h-12 flex-col items-center justify-center gap-0.5 ${
        active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={20} />
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  )
}
