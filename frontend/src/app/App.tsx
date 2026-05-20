import { useState, useEffect, Component, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { SessionProvider, useSession } from '@/hooks/useSession'
import { KioskLayout } from '@/layouts/KioskLayout'
import { MobileLayout } from '@/layouts/MobileLayout'
import { LoginScreen } from '@/screens/LoginScreen'
import { AdminLayout } from '@/screens/Admin/AdminLayout'
import { SetupScreen } from '@/screens/SetupScreen'
import { RoomSelector } from '@/screens/RoomSelector'
import { ConnectScreen } from '@/screens/ConnectScreen'
import { setupApi, authApi } from '@/api/client'

/** Returns true when the viewport is narrower than 768px. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

function AppRoutes() {
  const location = useLocation()
  // ALL hooks must be called unconditionally (Rules of Hooks)
  const { user, isLoading, currentRoomId, setRoom, forcePinChange, clearForcePinChange } = useSession()
  const isMobile = useIsMobile()
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)
  const [roomSelected, setRoomSelected] = useState(!!currentRoomId && currentRoomId !== 'default')
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinSaving, setPinSaving] = useState(false)

  // Check setup status on mount (always called — hooks must never be conditional)
  useEffect(() => {
    setupApi.status()
      .then(({ needs_setup }) => setNeedsSetup(needs_setup))
      .catch(() => setNeedsSetup(false))
  }, [])

  // Non-admin users always use their own room (room_id = user_id).
  // Never show them a room selector — set their room automatically.
  useEffect(() => {
    if (user && user.role !== 'admin' && !roomSelected) {
      setRoom(user.id)
      setRoomSelected(true)
    }
  }, [user, roomSelected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Public /connect route — always available, no auth required.
  // ALL hooks above have been called unconditionally, so this early return is valid.
  if (location.pathname === '/connect') {
    return <ConnectScreen />
  }

  if (isLoading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--neon-primary)',
        fontSize: '2rem',
      }}>
        ♛
      </div>
    )
  }

  // Show loading while setup status is being fetched
  if (needsSetup === null) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--neon-primary)',
        fontSize: '2rem',
      }}>
        ♛
      </div>
    )
  }

  // First-time setup wizard
  if (needsSetup) {
    return <SetupScreen onComplete={() => setNeedsSetup(false)} />
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="*"      element={<LoginScreen />} />
      </Routes>
    )
  }

  if (forcePinChange) {
    async function handleSetPin(e: React.FormEvent) {
      e.preventDefault()
      if (newPin.length < 4) { setPinError('PIN skal være mindst 4 tegn'); return }
      if (newPin !== newPinConfirm) { setPinError('Koderne matcher ikke'); return }
      setPinSaving(true)
      setPinError('')
      try {
        await authApi.setPin(newPin)
        clearForcePinChange()
      } catch (err: unknown) {
        setPinError(err instanceof Error ? err.message : 'Fejl')
      } finally {
        setPinSaving(false)
      }
    }
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse at center, #1a0a30 0%, #0d0520 70%)' }}>
        <div className="glass-card" style={{ padding: '2.5rem', width: '100%', maxWidth: '380px' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '2.5rem' }}>🔑</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', letterSpacing: '2px', color: 'var(--chrome-bright)', textTransform: 'uppercase', margin: '8px 0 4px' }}>Vælg din kode</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Din engangskode virker kun første gang.<br />Vælg din egen personlige kode.</p>
          </div>
          <form onSubmit={handleSetPin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>Ny PIN-kode</label>
              <input className="input" type="password" value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="Min. 4 tegn" autoFocus />
            </div>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>Gentag PIN-kode</label>
              <input className="input" type="password" value={newPinConfirm} onChange={e => setNewPinConfirm(e.target.value)} placeholder="Skriv koden igen" />
            </div>
            {pinError && <p style={{ color: 'var(--neon-accent)', fontSize: '0.85rem', textAlign: 'center' }}>{pinError}</p>}
            <button type="submit" className="btn btn-primary" disabled={pinSaving} style={{ width: '100%', padding: '14px', marginTop: '4px' }}>
              {pinSaving ? 'Gemmer…' : '✅ Gem min kode & gå til jukebox'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/"        element={user.role === 'admin' ? <Navigate to="/admin" replace /> : (isMobile ? <MobileLayout /> : <KioskLayout />)} />
      <Route path="/admin"   element={user.role === 'admin' ? <AdminLayout /> : <Navigate to="/" replace />} />
      <Route path="/jukebox" element={user.role === 'admin' ? (isMobile ? <MobileLayout /> : <KioskLayout />) : <Navigate to="/" replace />} />
      <Route path="*"        element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <AppErrorBoundary>
            <AppRoutes />
          </AppErrorBoundary>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#0d0520', color: '#f5f0ff', gap: '16px', padding: '32px', textAlign: 'center',
        }}>
          <span style={{ fontSize: '2.5rem', color: '#bf00ff' }}>♛</span>
          <h2 style={{ color: '#ff2d78', fontSize: '1.1rem' }}>Noget gik galt</h2>
          <p style={{ color: '#a090c0', fontSize: '0.85rem' }}>{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
            style={{
              padding: '12px 24px', background: 'rgba(191,0,255,0.2)', border: '1px solid #bf00ff',
              borderRadius: '8px', color: '#f5f0ff', cursor: 'pointer', fontSize: '0.9rem',
            }}
          >
            Genindlæs siden
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
