import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '@/hooks/useSession'

export function LoginScreen() {
  const { login, loginWithQR } = useSession()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [pin, setPin]           = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)

  // Auto-login if ?token= is present in URL (guest QR code flow)
  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) return
    setAutoLogin(true)
    setError('')
    loginWithQR(token).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Ugyldig eller udløbet QR kode')
      setAutoLogin(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (autoLogin) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(ellipse at center, #1a0a30 0%, #0d0520 70%)',
      }}>
        <div style={{ textAlign: 'center', color: 'var(--neon-primary)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>♛</div>
          <p style={{ fontFamily: 'var(--font-display)', letterSpacing: '2px', fontSize: '1rem', color: 'var(--chrome-bright)' }}>
            KOBLER TIL…
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, pin)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #1a0a30 0%, #0d0520 70%)',
    }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="glass-card"
        style={{ padding: '2.5rem', width: '100%', maxWidth: '380px' }}
      >
        {/* Crown / Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="neon-text-primary" style={{ fontSize: '3rem' }}>♛</div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.8rem',
            letterSpacing: '3px',
            color: 'var(--chrome-bright)',
            textTransform: 'uppercase',
          }}>
            CrownJukebox
          </h1>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '4px' }}>
            Log ind for at tilgå musikken
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>
              Brugernavn
            </label>
            <input
              className="input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin"
              required
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>
              PIN-kode
            </label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              placeholder="••••••"
              required
            />
          </div>

          {error && (
            <p style={{ color: 'var(--neon-accent)', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', padding: '14px' }}
          >
            {loading ? 'Logger ind…' : 'Log ind'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}
