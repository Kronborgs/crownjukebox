import { useState, useEffect, useRef } from 'react'

interface YouTubeResult {
  video_id: string
  title: string
  channel_name: string
  thumbnail_url: string
}

interface AddedSong {
  title: string
  artist: string
}

/**
 * ConnectScreen — mobile YouTube search page opened via QR code.
 *
 * Accessed at /connect?s=SESSION_ID on the user's phone.
 * Does NOT use the jukebox auth token — all requests are authenticated
 * only by the short-lived session ID embedded in the URL.
 */
export function ConnectScreen() {
  const sessionId = new URLSearchParams(window.location.search).get('s') ?? ''

  type State = 'loading' | 'invalid' | 'ready' | 'adding' | 'done'
  const [state, setState] = useState<State>('loading')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<YouTubeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [addedSong, setAddedSong] = useState<AddedSong | null>(null)
  const [error, setError] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Verify session on mount ─────────────────────────────────────
  useEffect(() => {
    if (!sessionId) { setState('invalid'); return }
    fetch(`/api/external/status?s=${encodeURIComponent(sessionId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setState('invalid'); return }
        if (data.status === 'done') {
          setAddedSong(data.added_song ?? null)
          setState('done')
        } else {
          setState('ready')
        }
      })
      .catch(() => setState('invalid'))
  }, [sessionId])

  // ── Debounced YouTube search ────────────────────────────────────
  useEffect(() => {
    if (state !== 'ready') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); return }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(
          `/api/external/youtube/search?s=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(query)}`
        )
        const data = await r.json()
        if (r.ok && Array.isArray(data)) {
          setResults(data)
        } else {
          setError(data?.error ?? 'Søgefejl')
        }
      } catch {
        setError('Netværksfejl — prøv igen')
      } finally {
        setSearching(false)
      }
    }, 500)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, state, sessionId])

  // ── Add song to queue ───────────────────────────────────────────
  async function addToQueue(result: YouTubeResult) {
    if (addingId) return
    setAddingId(result.video_id)
    setError('')
    try {
      const r = await fetch('/api/external/queue-song', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          video_id: result.video_id,
          title: result.title,
          channel_name: result.channel_name,
        }),
      })
      const data = await r.json()
      if (!r.ok) {
        setError(data?.error ?? 'Kunne ikke tilføje sang')
      } else {
        setAddedSong({ title: data.title, artist: data.artist })
        setState('done')
      }
    } catch {
      setError('Netværksfejl — prøv igen')
    } finally {
      setAddingId(null)
    }
  }

  // ── Styles ──────────────────────────────────────────────────────
  const page: React.CSSProperties = {
    minHeight: '100dvh',
    background: 'radial-gradient(ellipse at 50% 0%, #1a0a30 0%, #0d0520 70%)',
    color: '#f5f0ff',
    fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
    display: 'flex',
    flexDirection: 'column',
  }

  const header: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 16px',
    borderBottom: '1px solid rgba(191,0,255,0.2)',
    flexShrink: 0,
  }

  // ── Render: loading ─────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '2.5rem', color: '#bf00ff', textShadow: '0 0 24px #bf00ff88' }}>♛</span>
        <p style={{ color: '#a090c0', marginTop: '12px' }}>Indlæser…</p>
      </div>
    )
  }

  // ── Render: invalid session ─────────────────────────────────────
  if (state === 'invalid') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center' }}>
        <span style={{ fontSize: '2.5rem' }}>⌛</span>
        <h2 style={{ color: '#ff2d78', fontFamily: 'Georgia, serif', marginTop: '12px' }}>Session udløbet</h2>
        <p style={{ color: '#a090c0', marginTop: '8px', lineHeight: 1.6 }}>
          QR-koden er ugyldig eller udløbet.<br />
          Gå tilbage til jukeboxen og åbn panelet igen.
        </p>
      </div>
    )
  }

  // ── Render: done ────────────────────────────────────────────────
  if (state === 'done') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center' }}>
        <span style={{ fontSize: '3rem' }}>🎶</span>
        <h2 style={{
          color: '#00e5ff',
          fontFamily: 'Georgia, serif',
          marginTop: '16px',
          textShadow: '0 0 16px #00e5ff66',
        }}>
          Tilføjet til køen!
        </h2>
        {addedSong && (
          <>
            <p style={{ fontWeight: 600, fontSize: '1.05rem', marginTop: '12px' }}>{addedSong.title}</p>
            <p style={{ color: '#a090c0', fontSize: '0.9rem', marginTop: '4px' }}>{addedSong.artist}</p>
          </>
        )}
        <p style={{ color: '#5a4a78', fontSize: '0.8rem', marginTop: '20px' }}>
          Du kan lukke denne side.
        </p>
      </div>
    )
  }

  // ── Render: adding (long download) ─────────────────────────────
  if (state === 'adding') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center' }}>
        <span style={{ fontSize: '2.5rem', animation: 'spin 1.5s linear infinite' }}>⏳</span>
        <h2 style={{ color: '#00e5ff', fontFamily: 'Georgia, serif', marginTop: '16px' }}>
          Downloader sang…
        </h2>
        <p style={{ color: '#a090c0', marginTop: '8px', lineHeight: 1.6, fontSize: '0.85rem' }}>
          Dette kan tage op til et minut.<br />
          Bliv venligst på siden.
        </p>
      </div>
    )
  }

  // ── Render: ready (search UI) ───────────────────────────────────
  return (
    <div style={page}>
      {/* Header */}
      <div style={header}>
        <span style={{ fontSize: '1.4rem', color: '#bf00ff', textShadow: '0 0 12px #bf00ff88' }}>♛</span>
        <span style={{
          fontFamily: 'Georgia, serif',
          fontSize: '0.9rem',
          letterSpacing: '3px',
          color: '#f0f0ff',
          textTransform: 'uppercase',
        }}>
          CrownJukebox
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: '0.72rem',
          color: '#00e5ff',
          fontFamily: '"Courier New", monospace',
          opacity: 0.75,
        }}>
          YouTube-søgning
        </span>
      </div>

      {/* Search box */}
      <div style={{ padding: '16px', borderBottom: '1px solid rgba(191,0,255,0.12)' }}>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Sang, artist eller album…"
          autoFocus
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '14px 16px',
            background: 'rgba(21, 10, 46, 0.9)',
            border: '1px solid rgba(0, 229, 255, 0.4)',
            borderRadius: '8px',
            color: '#f5f0ff',
            fontSize: '1rem',
            fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
            outline: 'none',
          }}
        />
        {searching && (
          <p style={{ color: '#a090c0', fontSize: '0.8rem', marginTop: '8px', textAlign: 'center' }}>
            Søger…
          </p>
        )}
        {error && (
          <p style={{ color: '#ff2d78', fontSize: '0.8rem', marginTop: '8px', textAlign: 'center' }}>
            {error}
          </p>
        )}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {!query.trim() && (
          <p style={{ color: '#5a4a78', textAlign: 'center', padding: '32px 16px', fontSize: '0.9rem' }}>
            Skriv sangnavnet eller artistens navn ovenfor.
          </p>
        )}

        {results.map(result => (
          <div
            key={result.video_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            {/* Thumbnail */}
            {result.thumbnail_url && (
              <img
                src={result.thumbnail_url}
                alt=""
                style={{
                  width: '56px',
                  height: '42px',
                  objectFit: 'cover',
                  borderRadius: '4px',
                  flexShrink: 0,
                }}
              />
            )}

            {/* Title + channel */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: 0,
                fontWeight: 600,
                fontSize: '0.88rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: '#f5f0ff',
              }}>
                {result.title}
              </p>
              <p style={{
                margin: '2px 0 0',
                fontSize: '0.76rem',
                color: '#a090c0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {result.channel_name}
              </p>
            </div>

            {/* Add button */}
            <button
              onClick={() => addToQueue(result)}
              disabled={!!addingId}
              style={{
                flexShrink: 0,
                padding: '8px 14px',
                background: addingId === result.video_id
                  ? 'rgba(0,229,255,0.15)'
                  : 'linear-gradient(135deg, #bf00ff, #7e2bff)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: addingId ? 'not-allowed' : 'pointer',
                opacity: addingId && addingId !== result.video_id ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
            >
              {addingId === result.video_id ? '⏳' : '＋'}
            </button>
          </div>
        ))}

        {query.trim() && !searching && results.length === 0 && (
          <p style={{ color: '#5a4a78', textAlign: 'center', padding: '32px 16px', fontSize: '0.9rem' }}>
            Ingen resultater for "{query}"
          </p>
        )}
      </div>
    </div>
  )
}
