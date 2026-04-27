import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { libraryApi } from '@/api/client'

interface Props {
  artId: string
  size?: 'small' | 'medium' | 'large'
  alt?: string
  className?: string
  style?: React.CSSProperties
  /** px dimensions for the placeholder box */
  width?: number
  height?: number
}

/**
 * CoverArt — loads album art with skeleton + retro SVG fallback.
 */
export function CoverArt({ artId, size = 'medium', alt = 'Album cover', className, style, width, height }: Props) {
  const src = artId && artId !== 'null' && artId !== ''
    ? libraryApi.coverUrl(artId, size)
    : null

  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(src ? 'loading' : 'error')
  const imgRef = useRef<HTMLImageElement>(null)

  // Reset status when artId changes (e.g. after artwork rescan)
  useEffect(() => {
    setStatus(src ? 'loading' : 'error')
  }, [src])

  const boxStyle: React.CSSProperties = {
    width:  width  ?? '100%',
    height: height ?? '100%',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    position: 'relative',
    ...style,
  }

  return (
    <div className={className} style={boxStyle}>
      {/* Skeleton */}
      <AnimatePresence>
        {status === 'loading' && (
          <motion.div
            key="skeleton"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="skeleton"
            style={{ position: 'absolute', inset: 0 }}
          />
        )}
      </AnimatePresence>

      {/* Image or placeholder */}
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: status === 'error' ? 'none' : 'block',
          }}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      ) : null}

      {/* Fallback vinyl placeholder */}
      {(status === 'error' || !src) && (
        <PlaceholderCover />
      )}
    </div>
  )
}

function PlaceholderCover() {
  return (
    <svg
      viewBox="0 0 300 300"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        <linearGradient id="pgrd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a0a2e" />
          <stop offset="100%" stopColor="#3d0070" />
        </linearGradient>
        <radialGradient id="vign" cx="50%" cy="50%" r="70%">
          <stop offset="60%" stopColor="transparent" />
          <stop offset="100%" stopColor="#00000088" />
        </radialGradient>
      </defs>
      <rect width="300" height="300" fill="url(#pgrd)" />
      <rect width="300" height="300" fill="url(#vign)" />
      {/* Vinyl grooves */}
      {[110, 90, 70, 50, 30].map(r => (
        <circle key={r} cx="150" cy="150" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      ))}
      {/* Label */}
      <circle cx="150" cy="150" r="40" fill="#bf00ff22" stroke="#bf00ff44" strokeWidth="1" />
      <circle cx="150" cy="150" r="8" fill="#00000088" />
      {/* Crown */}
      <text x="150" y="157" textAnchor="middle" fontSize="18" fill="rgba(191,0,255,0.6)">♛</text>
    </svg>
  )
}
