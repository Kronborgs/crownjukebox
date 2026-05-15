import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { libraryApi, Album, Track, queueApi, adminApi } from '@/api/client'
import { CoverArt } from '@/components/CoverArt'
import { Plus, ChevronLeft, ChevronRight, Clock, Loader2, AlertCircle, Check } from 'lucide-react'

const DIGITS     = ['0','1','2','3','4','5','6','7','8','9']
const ALPHA_ROW1 = ['A','B','C','D','E','F','G','H','I','J','K']
const ALPHA_ROW2 = ['L','M','N','O','P','Q','R','S','T','U','V']
const ALPHA_ROW3 = ['W','X','Y','Z','Æ','Ø','Å']
const ALL_FILTERS = ['Alle', ...DIGITS, ...ALPHA_ROW1, ...ALPHA_ROW2, ...ALPHA_ROW3]
const PAGE_SIZE = 24

function JukeKey({ label, active, wide, onClick }: { label: string; active: boolean; wide?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`retro-key${wide ? ' retro-key-wide' : ''}${active ? ' is-active' : ''}`}
      style={{ height: '34px', minWidth: wide ? '52px' : '34px', padding: '0 6px', fontSize: '0.78rem' }}
    >
      {label}
    </button>
  )
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AlbumBrowser({ onSearchTab, onQueueTab }: { onSearchTab?: () => void; onQueueTab?: () => void } = {}) {
  const qc = useQueryClient()
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null)
  const [addedTrackId, setAddedTrackId] = useState<string | null>(null)
  const [letterFilter, setLetterFilter] = useState('Alle')
  const [page, setPage] = useState(1)
  const [confirmTrack, setConfirmTrack] = useState<Track | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [focusedAlbumIdx, setFocusedAlbumIdx] = useState(-1)
  const [focusedTrackIdx, setFocusedTrackIdx] = useState(-1)

  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: adminApi.settings })
  const confirmAdd = (settings as Record<string, string>)['queue_confirm_add'] === '1'

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: () => libraryApi.albums(undefined, 1, 500),
    staleTime: 60_000,
  })

  const { data: tracks = [], isLoading: tracksLoading, isError: tracksError } = useQuery({
    queryKey: ['album-tracks', selectedAlbum?.id],
    queryFn: () => libraryApi.albumTracks(selectedAlbum!.id),
    enabled: selectedAlbum !== null && !!selectedAlbum?.id,
  })

  useEffect(() => {
    setPage(1)
    setFocusedAlbumIdx(-1)
  }, [letterFilter])

  useEffect(() => {
    setFocusedTrackIdx(-1)
  }, [selectedAlbum?.id])

  const filteredAlbums = (albums as Album[]).filter((album) => {
    if (letterFilter === 'Alle') return true
    const label = (album.title || '').trim().toUpperCase()
    return label.startsWith(letterFilter)
  })

  const totalPages = Math.max(1, Math.ceil(filteredAlbums.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleAlbums = filteredAlbums.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Refs for stable keyboard event handler (avoids stale closures with empty dep array)
  const selectedAlbumRef = useRef<Album | null>(null)
  const tracksRef = useRef<Track[]>([])
  const visibleAlbumsRef = useRef<Album[]>([])
  const letterFilterRef = useRef('Alle')
  const focusedAlbumIdxRef = useRef(-1)
  const focusedTrackIdxRef = useRef(-1)
  const handleTrackClickRef = useRef<((track: Track) => void) | null>(null)
  selectedAlbumRef.current = selectedAlbum
  tracksRef.current = tracks as Track[]
  visibleAlbumsRef.current = visibleAlbums
  letterFilterRef.current = letterFilter
  focusedAlbumIdxRef.current = focusedAlbumIdx
  focusedTrackIdxRef.current = focusedTrackIdx

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 2500)
  }

  async function addToQueue(track: Track) {
    if (addedTrackId === track.id) return // debounce: prevent double-click re-submit
    try {
      await queueApi.add(track.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ukendt fejl'
      showToast(msg === 'track is already in the queue' ? 'Nummeret er allerede i køen' : `Fejl: ${msg}`, false)
      return
    }
    setAddedTrackId(track.id)
    setTimeout(() => setAddedTrackId(null), 1500)
    showToast(`✓ ${track.title} tilføjet`)
    qc.invalidateQueries({ queryKey: ['queue'] })
    // Backend auto-starts playback when adding to queue — no extra play() call needed here.
    qc.invalidateQueries({ queryKey: ['playback-state'] })
  }

  function handleTrackClick(track: Track) {
    if (confirmAdd) {
      setConfirmTrack(track)
    } else {
      addToQueue(track)
    }
  }

  handleTrackClickRef.current = handleTrackClick

  // ── Keyboard navigation (pil-taster, Enter, Home, PageUp/Down) ─────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT') return
      const album = selectedAlbumRef.current
      const tks   = tracksRef.current
      const vas   = visibleAlbumsRef.current
      const ftIdx = focusedTrackIdxRef.current
      const faIdx = focusedAlbumIdxRef.current
      if (album) {
        // ── Track list navigation ──
        if      (e.key === 'ArrowDown')              { e.preventDefault(); setFocusedTrackIdx(i => Math.min(tks.length - 1, i < 0 ? 0 : i + 1)) }
        else if (e.key === 'ArrowUp')                { e.preventDefault(); setFocusedTrackIdx(i => Math.max(0, i <= 0 ? 0 : i - 1)) }
        else if (e.key === 'Enter')                  { e.preventDefault(); if (ftIdx >= 0 && ftIdx < tks.length) handleTrackClickRef.current?.(tks[ftIdx]) }
        else if (e.key === 'Escape' || e.key === 'Home') { e.preventDefault(); setSelectedAlbum(null) }
      } else {
        // ── Album grid navigation ──
        const COLS = 4
        if      (e.key === 'ArrowRight')  { e.preventDefault(); setFocusedAlbumIdx(i => Math.min(vas.length - 1, i < 0 ? 0 : i + 1)) }
        else if (e.key === 'ArrowLeft')   { e.preventDefault(); setFocusedAlbumIdx(i => Math.max(0, i <= 0 ? 0 : i - 1)) }
        else if (e.key === 'ArrowDown')   { e.preventDefault(); setFocusedAlbumIdx(i => Math.min(vas.length - 1, i < 0 ? 0 : i + COLS)) }
        else if (e.key === 'ArrowUp')     { e.preventDefault(); setFocusedAlbumIdx(i => Math.max(0, i < COLS ? 0 : i - COLS)) }
        else if (e.key === 'Enter')       { e.preventDefault(); if (faIdx >= 0 && faIdx < vas.length) setSelectedAlbum(vas[faIdx]) }
        else if (e.key === 'Home')        { e.preventDefault(); setLetterFilter('Alle'); setFocusedAlbumIdx(-1) }
        else if (e.key === 'PageDown')    { e.preventDefault(); const i = ALL_FILTERS.indexOf(letterFilterRef.current); setLetterFilter(ALL_FILTERS[Math.min(ALL_FILTERS.length - 1, i + 1)]) }
        else if (e.key === 'PageUp')      { e.preventDefault(); const i = ALL_FILTERS.indexOf(letterFilterRef.current); setLetterFilter(ALL_FILTERS[Math.max(0, i - 1)]) }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, []) // stable via refs — no dep array needed

  if (selectedAlbum) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative' }}>
        {/* Toast notification */}
        <AnimatePresence>
          {toast && (
            <motion.div
              key="toast"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              style={{
                position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
                zIndex: 100, pointerEvents: 'none',
                background: toast.ok ? 'rgba(0,180,80,0.92)' : 'rgba(200,40,40,0.92)',
                color: '#fff', borderRadius: '8px',
                padding: '8px 18px', fontSize: '0.85rem', fontWeight: 700,
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                whiteSpace: 'nowrap', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>
        {/* Bekræftelsesdialog */}
        <AnimatePresence>
          {confirmTrack && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: 'absolute', inset: 0, zIndex: 50,
                background: 'rgba(0,0,0,0.75)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '24px',
              }}
              onClick={() => setConfirmTrack(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="glass-card"
                style={{ padding: '24px', maxWidth: '360px', width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}
              >
                <p style={{ fontWeight: 700, fontSize: '1rem' }}>Tilføj til kø?</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <strong style={{ color: 'var(--chrome-bright)' }}>{confirmTrack.title}</strong>
                  {confirmTrack.artist && <span> — {confirmTrack.artist}</span>}
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setConfirmTrack(null)}>Annuller</button>
                  <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => { addToQueue(confirmTrack); setConfirmTrack(null) }}>
                    <Check size={16} /> Tilføj
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ display: 'flex', gap: '16px', padding: '16px', background: 'var(--bg-panel)', alignItems: 'center' }}>
          <button className="btn btn-ghost btn-icon" onClick={() => setSelectedAlbum(null)}>
            <ChevronLeft size={20} />
          </button>
          <div style={{ width: '72px', height: '72px', flexShrink: 0 }}>
            <CoverArt artId={selectedAlbum.cover_art_id} size="small" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedAlbum.title}</h2>
            <p style={{ color: 'var(--neon-primary)', fontSize: '0.9rem' }}>{selectedAlbum.artist_name}</p>
            {selectedAlbum.year && <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{selectedAlbum.year}</p>}
          </div>
          {(onSearchTab || onQueueTab) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
              {onSearchTab && (
                <button onClick={onSearchTab} style={{ padding: '5px 10px', fontSize: '0.65rem', fontWeight: 800, fontFamily: '"Courier New", monospace', letterSpacing: '1.5px', background: 'linear-gradient(160deg, #3d2808, #2a1a04)', color: 'rgba(255,210,100,0.85)', border: '1px solid #4a3010', borderRadius: '3px', cursor: 'pointer' }}>🔍 SØG</button>
              )}
              {onQueueTab && (
                <button onClick={onQueueTab} style={{ padding: '5px 10px', fontSize: '0.65rem', fontWeight: 800, fontFamily: '"Courier New", monospace', letterSpacing: '1.5px', background: 'linear-gradient(160deg, #3d2808, #2a1a04)', color: 'rgba(255,210,100,0.85)', border: '1px solid #4a3010', borderRadius: '3px', cursor: 'pointer' }}>≡ KØ</button>
              )}
            </div>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {tracksLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px', color: 'var(--text-dim)' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}
          {tracksError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '32px', color: 'var(--neon-red, #ff4444)', justifyContent: 'center' }}>
              <AlertCircle size={18} />
              <span>Kunne ikke hente numre — se konsol for detaljer</span>
            </div>
          )}
          {!tracksLoading && !tracksError && tracks.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '32px', color: 'var(--text-dim)', justifyContent: 'center', flexDirection: 'column' }}>
              <span style={{ fontSize: '2rem' }}>♩</span>
              <span>Ingen numre fundet i dette album</span>
            </div>
          )}
          <AnimatePresence mode="popLayout">
            {(tracks as Track[]).map((track, index) => (
              <motion.div
                key={track.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                onClick={() => { setFocusedTrackIdx(index); handleTrackClick(track) }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  backgroundColor: focusedTrackIdx === index ? 'rgba(191,0,255,0.18)' : undefined,
                  outline: focusedTrackIdx === index ? '1px solid rgba(191,0,255,0.4)' : 'none',
                  outlineOffset: '-1px',
                }}
                whileHover={{ backgroundColor: 'rgba(191,0,255,0.1)' }}
                whileTap={{ scale: 0.98 }}
              >
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', width: '24px', textAlign: 'right', flexShrink: 0 }}>
                  {addedTrackId === track.id ? <Check size={14} style={{ color: 'var(--neon-primary)' }} /> : (track.track_number || index + 1)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: addedTrackId === track.id ? 'var(--neon-primary)' : undefined }}>
                    {track.title}
                  </p>
                  {track.artist !== selectedAlbum.artist_name && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{track.artist}</p>
                  )}
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-dim)', fontSize: '0.8rem', flexShrink: 0 }}>
                  <Clock size={12} />
                  {formatTime(track.duration_secs)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); handleTrackClick(track) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                    background: addedTrackId === track.id ? 'var(--neon-primary)' : 'rgba(191,0,255,0.35)',
                    color: 'white', transition: 'background 0.2s',
                    border: 'none', cursor: 'pointer', padding: 0,
                  }}
                  aria-label="Tilføj til kø"
                >
                  {addedTrackId === track.id ? <Check size={14} /> : <Plus size={14} />}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* ── Album grid (scrollable) ── */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '4px 8px 4px' }}>
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(140px, 12vw, 200px), 1fr))', gap: '12px' }}>
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="skeleton" style={{ aspectRatio: '1', borderRadius: 'var(--radius-md)' }} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(140px, 12vw, 200px), 1fr))', gap: '12px' }}>
            <AnimatePresence>
              {visibleAlbums.map((album, index) => (
                <motion.div
                  key={album.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(index * 0.02, 0.4) }}
                  whileHover={{ scale: 1.04, zIndex: 1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedAlbum(album)}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    aspectRatio: '1',
                    boxShadow: focusedAlbumIdx === index
                      ? '0 0 0 3px var(--neon-primary), 0 4px 20px rgba(191,0,255,0.4)'
                      : '0 4px 20px rgba(0,0,0,0.5)',
                    transition: 'box-shadow 0.15s',
                  }}>
                    <CoverArt artId={album.cover_art_id} size="medium" alt={album.title} />
                  </div>
                  <div style={{ padding: '6px 2px' }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {album.title}
                    </p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {album.artist_name}
                    </p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', opacity: 0.7 }}>
                      {album.track_count} numre
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Pagination + Keyboard (fixed at bottom) ── */}
      <div style={{ padding: '0 8px 8px', flexShrink: 0 }}>

        {/* Pagination */}
        {!isLoading && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 2px 4px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
            <span>{filteredAlbums.length} album{letterFilter !== 'Alle' ? ` · ${letterFilter}` : ''}</span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button className="btn btn-ghost btn-icon" style={{ padding: '5px' }} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
                  <ChevronLeft size={14} />
                </button>
                <span>{safePage}/{totalPages}</span>
                <button className="btn btn-ghost btn-icon" style={{ padding: '5px' }} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Søg — full width above keyboard */}
        {onSearchTab && (
          <button
            onClick={onSearchTab}
            style={{
              width: '100%',
              marginBottom: '4px',
              padding: '8px 12px',
              fontSize: '0.78rem', fontWeight: 800,
              fontFamily: '"Courier New", "Lucida Console", monospace',
              letterSpacing: '3px',
              background: 'linear-gradient(180deg, #4a4f63 0%, #232738 45%, #0e1018 100%)',
              color: 'var(--chrome-bright)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: '6px 6px 0 0',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -2px 0 rgba(0,0,0,0.4)',
              userSelect: 'none',
            }}
          >
            🔍 SØG
          </button>
        )}

        {/* Row: Musik | keyboard | Kø */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'stretch' }}>

          {/* LEFT: Musik */}
          {onSearchTab && (
            <div style={{
              width: '38px',
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              padding: '12px 0',
              fontSize: '0.8rem', fontWeight: 800,
              fontFamily: '"Courier New", "Lucida Console", monospace',
              letterSpacing: '2px',
              background: 'linear-gradient(180deg, #4a4f63 0%, #232738 45%, #0e1018 100%)',
              color: 'var(--chrome-bright)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: '0 0 0 4px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -2px 0 rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.4)',
              flexShrink: 0,
              userSelect: 'none' as const,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              ♫ MUSIK
            </div>
          )}

          {/* CENTER: keyboard box — brushed aluminum panel with corner screws */}
          <div
            className="brushed-aluminum"
            style={{
              flex: 1,
              borderRadius: onSearchTab ? '0' : '6px 6px 8px 8px',
              padding: '14px 10px 14px',
              display: 'flex', flexDirection: 'column', gap: '5px',
            }}
          >
            {/* Corner screws (top-right + bottom-left via spans; top-left + bottom-right via CSS ::before/::after) */}
            <span className="screw screw-tr" />
            <span className="screw screw-bl" />
            {/* Alle + 0-9 centered */}
            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
              <JukeKey label="Alle" active={letterFilter === 'Alle'} wide onClick={() => setLetterFilter('Alle')} />
              {DIGITS.map(d => (
                <JukeKey key={d} label={d} active={letterFilter === d} onClick={() => setLetterFilter(d)} />
              ))}
            </div>
            {/* A–K */}
            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
              {ALPHA_ROW1.map(l => (
                <JukeKey key={l} label={l} active={letterFilter === l} onClick={() => setLetterFilter(l)} />
              ))}
            </div>
            {/* L–V */}
            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
              {ALPHA_ROW2.map(l => (
                <JukeKey key={l} label={l} active={letterFilter === l} onClick={() => setLetterFilter(l)} />
              ))}
            </div>
            {/* W–Å */}
            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
              {ALPHA_ROW3.map(l => (
                <JukeKey key={l} label={l} active={letterFilter === l} onClick={() => setLetterFilter(l)} />
              ))}
            </div>
          </div>

          {/* RIGHT: Kø */}
          {onQueueTab && (
            <button
              onClick={onQueueTab}
              style={{
                width: '38px',
                writingMode: 'vertical-rl',
                padding: '12px 0',
                fontSize: '0.8rem', fontWeight: 800,
                fontFamily: '"Courier New", "Lucida Console", monospace',
                letterSpacing: '2px',
                background: 'linear-gradient(180deg, #4a4f63 0%, #232738 45%, #0e1018 100%)',
                color: 'var(--chrome-bright)',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: '0 0 4px 0',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -2px 0 rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.4)',
                cursor: 'pointer',
                flexShrink: 0,
                userSelect: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              KØ ≡
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
