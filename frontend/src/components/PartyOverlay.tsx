import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'

interface Props {
  active: boolean
  onClose?: () => void
}

// PNG animation frames — served from /public/skaalanimation/
const ANIM_FRAMES = [
  '/skaalanimation/skalani1.png?v=3',
  '/skaalanimation/skalani2.png?v=3',
  '/skaalanimation/skalani3.png?v=3',
  '/skaalanimation/skalani4.png?v=3',
]

const PARTY_COLORS = ['#bf00ff', '#ff2d78', '#ffb300', '#00e5ff', '#39ff14']

export function PartyOverlay({ active, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const [frame, setFrame] = useState(0)

  // Cycle through PNG animation frames at ~3fps.
  useEffect(() => {
    if (!active) {
      setFrame(0)
      return
    }
    const id = setInterval(() => setFrame(f => (f + 1) % ANIM_FRAMES.length), 350)
    return () => clearInterval(id)
  }, [active])

  // Confetti cannon
  useEffect(() => {
    if (!active) {
      clearInterval(intervalRef.current)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const cannon = confetti.create(canvas, { resize: true, useWorker: false })

    cannon({
      particleCount: 120,
      spread: 100,
      origin: { y: 0.4 },
      colors: PARTY_COLORS,
      startVelocity: 40,
      gravity: 0.8,
    })

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

          {/* Animated PNG frames + dismiss hint */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            style={{
              zIndex: 1,
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.5rem',
            }}
          >
            <img
              src={ANIM_FRAMES[frame]}
              alt="SKÅL!"
              style={{
                width: 'min(380px, 72vw)',
                height: 'auto',
                imageRendering: 'crisp-edges',
                filter: 'drop-shadow(0 0 24px #bf00ff) drop-shadow(0 0 12px #ff2d78)',
              }}
            />
            
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
