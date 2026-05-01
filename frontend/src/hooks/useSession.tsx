import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react'
import { authApi, User, Permissions, ApiError, setCurrentRoomId, getCurrentRoomId } from '@/api/client'

interface SessionState {
  user: User | null
  permissions: Permissions | null
  token: string | null
  isLoading: boolean
  currentRoomId: string
  forcePinChange: boolean
}

interface SessionContextValue extends SessionState {
  login:  (username: string, pin: string) => Promise<void>
  logout: () => Promise<void>
  setRoom: (roomId: string) => void
  clearForcePinChange: () => void
  isAdmin: boolean
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    user:        null,
    permissions: null,
    token:       sessionStorage.getItem('cj_token'),
    isLoading:   true,
    currentRoomId: getCurrentRoomId(),
    forcePinChange: false,
  })

  // Validate existing token on mount
  useEffect(() => {
    if (!state.token) {
      setState(s => ({ ...s, isLoading: false }))
      return
    }
    authApi.me()
      .then(({ user, permissions }) => {
        // On page load with an existing token, restore the user's own room
        // if no specific room was already chosen (e.g., via admin viewJukebox).
        if (getCurrentRoomId() === 'default') {
          setCurrentRoomId(user.id)
        }
        setState(s => ({ ...s, user, permissions, isLoading: false, currentRoomId: getCurrentRoomId() }))
      })
      .catch((err: ApiError) => {
        if (err.status === 401) {
          sessionStorage.removeItem('cj_token')
          setCurrentRoomId('default')
          setState({ user: null, permissions: null, token: null, isLoading: false, currentRoomId: 'default', forcePinChange: false })
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
    setCurrentRoomId(user.id)
    const { permissions } = await authApi.me()
    setState(s => ({ ...s, user, permissions, token, isLoading: false, currentRoomId: user.id, forcePinChange: !!user.force_pin_change }))
  }, [])

  const logout = useCallback(async () => {
    try { await authApi.logout() } catch {}
    sessionStorage.removeItem('cj_token')
    setCurrentRoomId('default')
    setState({ user: null, permissions: null, token: null, isLoading: false, currentRoomId: 'default', forcePinChange: false })
  }, [])

  const clearForcePinChange = useCallback(() => {
    setState(s => ({ ...s, forcePinChange: false, user: s.user ? { ...s.user, force_pin_change: false } : null }))
  }, [])

  const setRoom = useCallback((roomId: string) => {
    setCurrentRoomId(roomId)
    setState(s => ({ ...s, currentRoomId: roomId }))
  }, [])

  const value: SessionContextValue = {
    ...state,
    login,
    logout,
    setRoom,
    clearForcePinChange,
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
