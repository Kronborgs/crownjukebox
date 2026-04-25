import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react'
import { authApi, User, Permissions, ApiError } from '@/api/client'

interface SessionState {
  user: User | null
  permissions: Permissions | null
  token: string | null
  isLoading: boolean
}

interface SessionContextValue extends SessionState {
  login:  (username: string, pin: string) => Promise<void>
  logout: () => Promise<void>
  isAdmin: boolean
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    user:        null,
    permissions: null,
    token:       sessionStorage.getItem('cj_token'),
    isLoading:   true,
  })

  // Validate existing token on mount
  useEffect(() => {
    if (!state.token) {
      setState(s => ({ ...s, isLoading: false }))
      return
    }
    authApi.me()
      .then(({ user, permissions }) => {
        setState(s => ({ ...s, user, permissions, isLoading: false }))
      })
      .catch((err: ApiError) => {
        if (err.status === 401) {
          sessionStorage.removeItem('cj_token')
          setState({ user: null, permissions: null, token: null, isLoading: false })
        } else {
          setState(s => ({ ...s, isLoading: false }))
        }
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Check access expiry periodically
  useEffect(() => {
    if (!state.user?.access_expires_at) return
    const check = () => {
      const expiry = new Date(state.user!.access_expires_at!).getTime()
      if (Date.now() > expiry) logout()
    }
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [state.user]) // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username: string, pin: string) => {
    const { token, user } = await authApi.login(username, pin)
    sessionStorage.setItem('cj_token', token)
    // Fetch full permissions
    const { permissions } = await authApi.me()
    setState({ user, permissions, token, isLoading: false })
  }, [])

  const logout = useCallback(async () => {
    try { await authApi.logout() } catch {}
    sessionStorage.removeItem('cj_token')
    setState({ user: null, permissions: null, token: null, isLoading: false })
  }, [])

  const value: SessionContextValue = {
    ...state,
    login,
    logout,
    isAdmin: state.user?.role === 'admin',
  }

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
