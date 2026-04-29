import { useState, useRef, KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { libraryApi, SearchResults, queueApi } from '@/api/client'
import { CoverArt } from '@/components/CoverArt'
import { Search as SearchIcon, Plus, X, Check } from 'lucide-react'

// Simple on-screen keyboard layout for kiosk mode
const KEYBOARD_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P','Å'],
  ['A','S','D','F','G','H','J','K','L','Æ','Ø'],
  ['Z','X','C','V','B','N','M',' ','⌫'],
]

export function SearchScreen() {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [showKeyboard, setShowKeyboard] = useState(false)
  const [addedTrackId, setAddedTrackId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: results } = useQuery<SearchResults>({
    queryKey: ['search', query],
    queryFn:  () => libraryApi.search(query),
    enabled:  query.trim().length > 0,
    staleTime: 10_000,
  })

  async function addToQueue(trackId: string) {
    if (addedTrackId === trackId) return
    try {
      await queueApi.add(trackId)
    } catch {
      // Duplicate or other error — silently ignore (backend returns 200 for duplicates)
      return
    }
    setAddedTrackId(trackId)
    setTimeout(() => setAddedTrackId(null), 1500)
    qc.invalidateQueries({ queryKey: ['queue'] })
    qc.invalidateQueries({ queryKey: ['playback-state'] })
  }

  function onKeyPress(k: string) {
    if (k === '⌫') {
      setQuery(q => q.slice(0, -1))
    } else {
      setQuery(q => q + k)
    }
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setQuery('')
      setShowKeyboard(false)
    }
  }

  const hasResults = results && (
    results.tracks.length > 0 ||
    results.albums.length > 0 ||
    results.artists.length > 0
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search input */}
      <div style={{ padding: '16px', position: 'relative' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SearchIcon size={18} style={{ position: 'absolute', left: '14px', color: 'var(--text-dim)', pointerEvents: 'none' }} />
          <input
            ref={inputRef}
            className="input"
            style={{ paddingLeft: '42px', paddingRight: query ? '42px' : '16px' }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setShowKeyboard(true)}
            onKeyDown={handleInputKeyDown}
            placeholder="Søg efter sang, album eller artist…"
            aria-label="Søg"
          />
          {query && (
            <button
              className="btn btn-ghost btn-icon"
              style={{ position: 'absolute', right: '8px', padding: '4px' }}
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              aria-label="Ryd søgning"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
        {query && !hasResults && (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: '2rem' }}>
            Ingen resultater for "{query}"
          </p>
        )}

        {results?.tracks && results.tracks.length > 0 && (
          <section style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              Sange
            </h3>
            {results.tracks.map(track => (
              <div
                key={track.id}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{track.artist}</p>
                </div>
                <button className="btn btn-primary btn-icon" style={{ padding: '6px', flexShrink: 0 }} onClick={() => addToQueue(track.id)} disabled={addedTrackId === track.id}>
                  {addedTrackId === track.id ? <Check size={16} /> : <Plus size={16} />}
                </button>
              </div>
            ))}
          </section>
        )}

        {results?.albums && results.albums.length > 0 && (
          <section style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              Albums
            </h3>
            <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
              {results.albums.map(album => (
                <div key={album.id} style={{ flexShrink: 0, width: '110px' }}>
                  <div style={{ width: '110px', height: '110px', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <CoverArt artId={album.cover_art_id} size="small" alt={album.title} />
                  </div>
                  <p style={{ fontSize: '0.75rem', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* On-screen keyboard */}
      <AnimatePresence>
        {showKeyboard && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{
              background: 'var(--bg-panel)',
              borderTop: '1px solid rgba(191,0,255,0.3)',
              padding: '12px',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
              <button className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '4px 12px' }} onClick={() => setShowKeyboard(false)}>
                Luk tastatur
              </button>
            </div>
            {KEYBOARD_ROWS.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginBottom: '4px' }}>
                {row.map(key => (
                  <button
                    key={key}
                    className="btn btn-ghost"
                    style={{
                      minWidth: key === ' ' ? '80px' : key === '⌫' ? '60px' : '36px',
                      height: '42px',
                      padding: '0',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      borderRadius: 'var(--radius-sm)',
                    }}
                    onMouseDown={e => { e.preventDefault(); onKeyPress(key === ' ' ? ' ' : key) }}
                  >
                    {key === ' ' ? '⎵' : key}
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
