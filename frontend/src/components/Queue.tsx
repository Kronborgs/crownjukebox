import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { queueApi, QueueItem, libraryApi } from '@/api/client'
import { CoverArt } from '@/components/CoverArt'
import { useSSE } from '@/hooks/useSSE'
import { X } from 'lucide-react'

function formatTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function Queue() {
  const qc = useQueryClient()
  const { data: items = [] } = useQuery({
    queryKey: ['queue'],
    queryFn:  queueApi.get,
    refetchInterval: false,
  })

  // Refresh queue whenever the backend says the queue changed
  // (e.g. track consumed by Advance(), skip, add, remove, reorder)
  useSSE({
    queue_changed: () => qc.invalidateQueries({ queryKey: ['queue'] }),
    now_playing_changed: () => qc.invalidateQueries({ queryKey: ['queue'] }),
  })

  async function remove(id: string) {
    await queueApi.remove(id)
    qc.invalidateQueries({ queryKey: ['queue'] })
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
        <p>Ingen sange i køen</p>
      </div>
    )
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      <AnimatePresence initial={false}>
        {items.map((item: QueueItem, idx: number) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              backgroundColor: idx === 0 ? 'rgba(191,0,255,0.08)' : 'transparent',
            }}
          >
            {/* Position number */}
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', width: '20px', textAlign: 'right', flexShrink: 0 }}>
              {idx + 1}
            </span>

            {/* Cover */}
            <div style={{ width: '44px', height: '44px', flexShrink: 0, borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <CoverArt artId={item.album_cover_art_id} size="small" />
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontWeight: 600,
                fontSize: '0.9rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: idx === 0 ? 'var(--neon-primary)' : 'var(--text-primary)',
              }}>
                {item.track_title}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.track_artist}
              </p>
            </div>

            {/* Duration */}
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', flexShrink: 0 }}>
              {formatTime(item.duration_secs)}
            </span>

            {/* Autoplay badge */}
            {item.is_autoplay && (
              <span className="badge badge-primary" style={{ flexShrink: 0 }}>auto</span>
            )}

            {/* Remove */}
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => remove(item.id)}
              style={{ padding: '4px', flexShrink: 0 }}
              aria-label="Fjern fra kø"
            >
              <X size={16} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
