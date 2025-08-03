import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Проверяем есть ли сохраненная сессия в localStorage
    const savedUser = localStorage.getItem('fintrack_user')
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser))
      } catch (error) {
        localStorage.removeItem('fintrack_user')
      }
    }
    setLoading(false)
  }, [])

  const login = async (email, password) => {
    // Временная заглушка для входа - в будущем заменить на Supabase
    const mockUser = {
      id: '1',
      email,
      name: 'Пользователь',
      workspace: 'Персональный'
    }
    
    setUser(mockUser)
    localStorage.setItem('fintrack_user', JSON.stringify(mockUser))
    return mockUser
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('fintrack_user')
  }

  const signUp = async (email, password, name) => {
    // Временная заглушка для регистрации
    const mockUser = {
      id: '1',
      email,
      name,
      workspace: 'Персональный'
    }
    
    setUser(mockUser)
    localStorage.setItem('fintrack_user', JSON.stringify(mockUser))
    return mockUser
  }

  const value = {
    user,
    login,
    logout,
    signUp,
    loading,
    isAuthenticated: !!user
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
