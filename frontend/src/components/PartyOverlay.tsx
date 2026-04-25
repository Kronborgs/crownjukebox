import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'

interface Props {
  active: boolean
  trackTitle?: string
  onClose?: () => void
}

const PARTY_COLORS = ['#bf00ff', '#ff2d78', '#ffb300', '#00e5ff', '#39ff14']

export function PartyOverlay({ active, trackTitle, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const burstRef = useRef<confetti.CreateTypes | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (!active) {
      clearInterval(intervalRef.current)
      return
    }

    // Create confetti cannon
    const canvas = canvasRef.current
    if (!canvas) return

    const cannon = confetti.create(canvas, { resize: true, useWorker: false })
    burstRef.current = cannon

    // Initial burst
    cannon({
      particleCount: 120,
      spread: 100,
      origin: { y: 0.4 },
      colors: PARTY_COLORS,
      startVelocity: 40,
      gravity: 0.8,
    })

    // Repeat bursts
    intervalRef.current = setInterval(() => {
      cannon({
        particleCount: 40,
        spread: 60,
        origin: { x: Math.random(), y: Math.random() * 0.4 },
        colors: PARTY_COLORS,
        startVelocity: 25,
        gravity: 0.9,
      })
    }, 1500)

    return () => {
      clearInterval(intervalRef.current)
      cannon.reset()
    }
  }, [active])

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="party-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Full-screen confetti canvas */}
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />

          {/* SKÅLE text */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            style={{
              textAlign: 'center',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          >
            <h1
              className="neon-blink"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(4rem, 12vw, 10rem)',
                fontWeight: 900,
                letterSpacing: '0.1em',
                color: '#fff',
                textShadow: '0 0 40px #ff2d78, 0 0 80px #bf00ff, 0 0 120px #ffb300',
                lineHeight: 1,
              }}
            >
              SKÅL!
            </h1>
            {trackTitle && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                style={{
                  color: 'var(--neon-amber)',
                  fontSize: '1.4rem',
                  marginTop: '1rem',
                  textShadow: 'var(--glow-amber)',
                }}
              >
                ♫ {trackTitle}
              </motion.p>
            )}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginTop: '2rem' }}
            >
              Tryk for at lukke
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
