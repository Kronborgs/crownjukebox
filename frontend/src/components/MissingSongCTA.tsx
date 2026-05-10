import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * MissingSongCTA — "Findes din sang ikke? Tryk her"
 *
 * A fully self-contained placeholder component for a future QR / Spotify /
 * YouTube login flow. Contains only local UI state — no API calls, no backend
 * changes, no auth logic.
 *
 * The button is intentionally visible to ALL users (admin and regular alike)
 * and therefore carries no permission guard.
 */
export function MissingSongCTA() {
  const [open, setOpen] = useState(false)

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
            onClick={() => setOpen(false)}
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
                maxWidth: '480px',
                padding: '32px 28px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '20px',
                border: '1px solid rgba(0, 229, 255, 0.28)',
                boxShadow: '0 0 40px rgba(0, 229, 255, 0.12), 0 0 80px rgba(191, 0, 255, 0.08)',
              }}
            >
              {/* Title */}
              <h2 style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: '1.45rem',
                fontWeight: 700,
                color: 'var(--neon-teal)',
                textShadow: 'var(--glow-teal)',
                letterSpacing: '2px',
                textAlign: 'center',
              }}>
                Mangler din sang?
              </h2>

              {/* Explanatory text */}
              <p style={{
                margin: 0,
                fontFamily: 'var(--font-body)',
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                textAlign: 'center',
                lineHeight: 1.6,
              }}>
                Senere vil du kunne scanne en QR-kode med din mobil, forbinde Spotify eller YouTube og
                tilføje sange, der ikke findes lokalt.
              </p>

              <p style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                color: 'var(--neon-teal)',
                textAlign: 'center',
                lineHeight: 1.5,
                opacity: 0.85,
              }}>
                Du skal ikke logge ind på selve jukeboxen.<br />
                Login sker sikkert på din egen mobil.
              </p>

              {/* QR-kode placeholder */}
              <div style={{
                width: '180px',
                height: '180px',
                border: '2px solid var(--neon-teal)',
                borderRadius: '8px',
                boxShadow: 'var(--glow-teal)',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gridTemplateRows: '1fr 1fr 1fr',
                padding: '14px',
                gap: '8px',
                position: 'relative',
                background: 'rgba(0, 229, 255, 0.04)',
                flexShrink: 0,
              }}>
                {/* Corner squares — top-left, top-right, bottom-left */}
                {[
                  { gridColumn: '1', gridRow: '1' },
                  { gridColumn: '3', gridRow: '1' },
                  { gridColumn: '1', gridRow: '3' },
                ].map((pos, i) => (
                  <div
                    key={i}
                    style={{
                      gridColumn: pos.gridColumn,
                      gridRow: pos.gridRow,
                      border: '2px solid var(--neon-teal)',
                      borderRadius: '3px',
                      background: 'rgba(0, 229, 255, 0.15)',
                    }}
                  />
                ))}
                {/* Center dot */}
                <div style={{
                  gridColumn: '2',
                  gridRow: '2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <div style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '3px',
                    background: 'var(--neon-teal)',
                    boxShadow: 'var(--glow-teal)',
                    opacity: 0.7,
                  }} />
                </div>
                {/* Label */}
                <div style={{
                  position: 'absolute',
                  bottom: '-26px',
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.65rem',
                  color: 'var(--text-dim)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                }}>
                  QR-kode kommer senere
                </div>
              </div>

              {/* Spacer to give room for the absolute label */}
              <div style={{ height: '12px' }} />

              {/* Disabled service buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                <button
                  className="btn btn-ghost"
                  disabled
                  style={{
                    width: '100%',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    letterSpacing: '1px',
                  }}
                >
                  🎵 Spotify QR-login kommer senere
                </button>
                <button
                  className="btn btn-ghost"
                  disabled
                  style={{
                    width: '100%',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    letterSpacing: '1px',
                  }}
                >
                  ▶ YouTube QR-login kommer senere
                </button>
              </div>

              {/* Active close button */}
              <button
                className="btn btn-primary"
                onClick={() => setOpen(false)}
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
