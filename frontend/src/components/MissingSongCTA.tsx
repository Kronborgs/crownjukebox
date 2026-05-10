import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCode } from 'react-qr-code'
import { externalApi, type ExternalStatus } from '@/api/client'

/**
 * MissingSongCTA — "Findes din sang ikke? Tryk her"
 *
 * When opened, creates a short-lived backend session and renders a real QR
 * code linking to the mobile YouTube search page (/connect?s=SESSION_ID).
 * Polls session status every 2 seconds and shows a success banner when the
 * user has added a song from their phone.
 *
 * Visible to ALL users — no permission guard.
 */
export function MissingSongCTA() {
  const [open, setOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [connectUrl, setConnectUrl] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<ExternalStatus | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Create a new session whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setSessionId(null)
    setConnectUrl(null)
    setSessionStatus(null)
    setSessionError(null)

    externalApi.createSession()
      .then(data => {
        setSessionId(data.session_id)
        setConnectUrl(data.connect_url)
      })
      .catch(err => {
        setSessionError(err instanceof Error ? err.message : 'Kunne ikke oprette session')
      })
  }, [open])

  // Poll session status every 2 seconds once we have a session.
  useEffect(() => {
    if (!sessionId) return
    if (sessionStatus?.status === 'done') return

    pollRef.current = setInterval(async () => {
      try {
        const st = await externalApi.getStatus(sessionId)
        setSessionStatus(st)
        if (st.status === 'done') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, 2000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [sessionId, sessionStatus?.status])

  function handleClose() {
    if (pollRef.current) clearInterval(pollRef.current)
    setOpen(false)
  }

  const done = sessionStatus?.status === 'done'
  const addedSong = sessionStatus?.added_song

  return (
    <>
      {/* ── Trigger button ───────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '10px 22px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.78rem',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          cursor: 'pointer',
          border: '1px solid var(--neon-teal)',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(0, 229, 255, 0.08)',
          color: 'var(--neon-teal)',
          boxShadow: 'var(--glow-teal)',
          transition: 'all var(--transition-fast)',
          userSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget
          el.style.background = 'rgba(0, 229, 255, 0.18)'
          el.style.transform = 'translateY(-1px)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget
          el.style.background = 'rgba(0, 229, 255, 0.08)'
          el.style.transform = 'none'
        }}
      >
        🔍 Findes din sang ikke? Tryk her
      </button>

      {/* ── Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="missing-song-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.82)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
            }}
          >
            <motion.div
              key="missing-song-card"
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 16 }}
              transition={{ duration: 0.22 }}
              onClick={e => e.stopPropagation()}
              className="glass-card"
              style={{
                width: '100%',
                maxWidth: '460px',
                padding: '32px 28px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '18px',
                border: '1px solid rgba(0, 229, 255, 0.28)',
                boxShadow: '0 0 40px rgba(0, 229, 255, 0.12), 0 0 80px rgba(191, 0, 255, 0.08)',
              }}
            >
              {/* Title */}
              <h2 style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: '1.4rem',
                fontWeight: 700,
                color: 'var(--neon-teal)',
                textShadow: 'var(--glow-teal)',
                letterSpacing: '2px',
                textAlign: 'center',
              }}>
                {done ? '✅ Sang tilføjet!' : 'Mangler din sang?'}
              </h2>

              {/* Success state */}
              {done && addedSong ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '1rem',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    margin: '0 0 4px',
                  }}>
                    {addedSong.title}
                  </p>
                  <p style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    margin: 0,
                  }}>
                    {addedSong.artist}
                  </p>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    color: 'var(--neon-teal)',
                    marginTop: '12px',
                    opacity: 0.85,
                  }}>
                    Sangen er tilføjet til køen. God fornøjelse! 🎶
                  </p>
                </div>
              ) : (
                <>
                  {/* Instruction */}
                  <p style={{
                    margin: 0,
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.88rem',
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                    lineHeight: 1.6,
                  }}>
                    Scan QR-koden med din mobil og søg efter sangen på YouTube.
                    Den tilføjes automatisk til køen.
                  </p>

                  {/* QR code */}
                  <div style={{
                    padding: '16px',
                    background: '#ffffff',
                    borderRadius: '10px',
                    boxShadow: '0 0 24px rgba(0, 229, 255, 0.3)',
                    flexShrink: 0,
                  }}>
                    {sessionError ? (
                      <div style={{
                        width: '180px',
                        height: '180px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.7rem',
                        color: '#cc2200',
                        padding: '8px',
                      }}>
                        {sessionError}
                      </div>
                    ) : connectUrl ? (
                      <QRCode
                        value={connectUrl}
                        size={180}
                        fgColor="#0d0520"
                        bgColor="#ffffff"
                      />
                    ) : (
                      <div style={{
                        width: '180px',
                        height: '180px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#aaa',
                        fontSize: '0.8rem',
                      }}>
                        Genererer QR…
                      </div>
                    )}
                  </div>

                  {/* Sub-label */}
                  <p style={{
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    color: 'var(--neon-teal)',
                    textAlign: 'center',
                    lineHeight: 1.5,
                    opacity: 0.8,
                  }}>
                    Du skal ikke logge ind på selve jukeboxen.<br />
                    Login sker sikkert på din egen mobil.
                  </p>

                  {/* Waiting indicator */}
                  <p style={{
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.7rem',
                    color: 'var(--text-dim)',
                    textAlign: 'center',
                    letterSpacing: '1px',
                  }}>
                    {connectUrl ? '⏳ Venter på mobilen…' : ''}
                  </p>
                </>
              )}

              {/* Close button */}
              <button
                className="btn btn-primary"
                onClick={handleClose}
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  letterSpacing: '1.5px',
                  padding: '14px',
                }}
              >
                ← Tilbage til jukebox
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
