import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import { Menu, X, Home, Users, Settings, BarChart3, Calendar, CreditCard, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, logout } = useAuth()

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen)

  const menuItems = [
    { icon: Home, label: 'Главная', path: '/' },
    { icon: CreditCard, label: 'Операции', path: '/operations' },
    { icon: Calendar, label: 'Запланированные', path: '/scheduled' },
    { icon: BarChart3, label: 'Аналитика', path: '/analytics' },
    { icon: Users, label: 'Справочники', path: '/directories' },
    { icon: Settings, label: 'Настройки', path: '/settings' },
  ]

  return (
    div className="flex min-h-screen bg-gray-50"
      {sidebarOpen  (
        div className="fixed inset-0 z-50 lg:hidden"
          div className="absolute inset-0 bg-black opacity-50" onClick={toggleSidebar}
          div className="relative flex flex-col w-64 h-full bg-white shadow-lg"
            div className="flex items-center justify-between p-4 border-b"
              h2 className="text-lg font-semibold text-gray-900"ФинУчёт/h2
              button onClick={toggleSidebar} className="p-1"
                X size={24} className="text-gray-600" /
              /button
            /div
            nav className="flex-1 p-4"
              ul className="space-y-2"
                {menuItems.map((item) = {
                  const Icon = item.icon
                  return (
                    li key={item.path}
                      Link
                        to={item.path}
                        onClick={toggleSidebar}
                        className="flex items-center space-x-3 py-2 px-3 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                      
                        Icon size={20} /
                        span{item.label}/span
                      /Link
                    /li
                  )
                })}
              /ul
            /nav
            div className="p-4 border-t flex items-center justify-between"
              div
                span className="text-sm text-gray-600"{user ? user.name : 'Гость'}/span
                div className="text-xs text-gray-500"{user ? user.email : ''}/div
              /div
              button onClick={() = logout()} className="p-1"
                LogOut size={20} className="text-gray-600" /
              /button
            /div
          /div
        /div
      )}

      div className="flex-1 flex flex-col"
        header className="bg-white shadow-sm border-b px-4 py-3 lg:hidden"
          div className="flex items-center justify-between"
            button onClick={toggleSidebar} className="p-1"
              Menu size={24} className="text-gray-600" /
            /button
            h1 className="text-xl font-semibold text-gray-900"ФинУчёт/h1
            div className="flex items-center space-x-2"
              span className="text-sm text-gray-600"Персональный/span
              div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center"
                span className="text-white text-sm font-medium"П/span
              /div
            /div
          /div
        /header

        main className="flex-1"
          Outlet /
        /main
      /div
    /div
  )
        </main>
      </div>
    </div>
  )
}
