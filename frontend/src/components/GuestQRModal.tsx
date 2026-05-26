import { useState, useEffect } from 'react'
import { QRCode } from 'react-qr-code'
import { authApi } from '@/api/client'
import { RefreshCw, X, ExternalLink, Copy, Check } from 'lucide-react'

interface Props {
  onClose: () => void
}

export function GuestQRModal({ onClose }: Props) {
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [copied, setCopied]     = useState(false)

  async function generate() {
    setLoading(true)
    setError('')
    setCopied(false)
    try {
      const { login_url } = await authApi.guestLink()
      setLoginUrl(login_url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Kunne ikke generere QR kode')
    } finally {
      setLoading(false)
    }
  }

  async function copyLink() {
    if (!loginUrl) return
    try {
      await navigator.clipboard.writeText(loginUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Kunne ikke kopiere link')
    }
  }

  useEffect(() => { generate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="glass-card"
        style={{
          padding: '32px', maxWidth: '340px', width: '90%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
          textAlign: 'center',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: '1rem',
            letterSpacing: '2px', color: 'var(--chrome-bright)', textTransform: 'uppercase',
          }}>
            Gæst QR Kode
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', lineHeight: 1.5 }}>
          Lad gæster scanne koden for at tilgå jukeboksen.<br />
          Gæster kan tilføje sange men ikke styre afspilning.
        </p>

        {/* QR Code */}
        <div style={{
          background: 'white', padding: '16px', borderRadius: '8px',
          minHeight: '200px', minWidth: '200px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {loading && (
            <p style={{ color: '#333', fontSize: '0.9rem' }}>Genererer…</p>
          )}
          {error && (
            <p style={{ color: '#c00', fontSize: '0.85rem' }}>{error}</p>
          )}
          {loginUrl && !loading && (
            <a
              href={loginUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Klik for at åbne gæstelink i browser"
              style={{ lineHeight: 0 }}
            >
              <QRCode value={loginUrl} size={200} />
            </a>
          )}
        </div>

        {loginUrl && !loading && !error && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', marginTop: '-4px' }}>
            Tip: Klik på QR-koden for at åbne gæstelogin direkte i browser.
          </p>
        )}

        <p style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>
          Gyldigt i 24 timer · Engangsbrug
        </p>

        {/* Actions */}
        <div style={{ display: 'grid', gap: '8px', width: '100%', gridTemplateColumns: '1fr 1fr' }}>
          <button
            className="btn btn-ghost"
            onClick={generate}
            disabled={loading}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.85rem' }}
          >
            <RefreshCw size={14} /> Ny kode
          </button>
          <a
            className="btn btn-ghost"
            href={loginUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!loginUrl || loading}
            onClick={(e) => {
              if (!loginUrl || loading) e.preventDefault()
            }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              fontSize: '0.85rem',
              opacity: loginUrl && !loading ? 1 : 0.45,
              pointerEvents: loginUrl && !loading ? 'auto' : 'none',
            }}
          >
            <ExternalLink size={14} /> Åbn i browser
          </a>
          <button
            className="btn btn-ghost"
            onClick={copyLink}
            disabled={!loginUrl || loading}
            style={{ gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.85rem' }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Link kopieret' : 'Kopiér gæstelink'}
          </button>
          <button
            className="btn btn-primary"
            onClick={onClose}
            style={{ gridColumn: '1 / span 2', fontSize: '0.85rem' }}
          >
            Luk
          </button>
        </div>
      </div>
    </div>
  )
}
