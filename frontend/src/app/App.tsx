import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SessionProvider, useSession } from '@/hooks/useSession'
import { KioskLayout } from '@/layouts/KioskLayout'
import { MobileLayout } from '@/layouts/MobileLayout'
import { LoginScreen } from '@/screens/LoginScreen'
import { AdminLayout } from '@/screens/Admin/AdminLayout'

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
  const { user, isLoading } = useSession()
  const isMobile = useIsMobile()

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

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/"      element={isMobile ? <MobileLayout /> : <KioskLayout />} />
      <Route path="/admin" element={user.role === 'admin' ? <AdminLayout /> : <Navigate to="/" replace />} />
      <Route path="*"      element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}
