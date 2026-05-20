import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { NowPlaying } from '@/components/NowPlaying'
import { AlbumBrowser } from '@/components/AlbumBrowser'
import { SearchScreen } from '@/components/SearchScreen'
import { Queue } from '@/components/Queue'
import { PartyOverlay } from '@/components/PartyOverlay'
import { GuestQRModal } from '@/components/GuestQRModal'
import { usePlayback } from '@/hooks/usePlayback'
import { useSession } from '@/hooks/useSession'
import { useSSE } from '@/hooks/useSSE'
import { partyApi } from '@/api/client'
import { Search, ListMusic, Disc3, LogOut, Settings, QrCode } from 'lucide-react'

type Tab = 'browse' | 'search' | 'queue'

/**
 * KioskLayout — full-screen 1080p jukebox layout.
 * Left column: Now Playing. Right column: tabbed Browse/Search/Queue.
 * Bottom: SKÅLE party button.
 */
export function KioskLayout() {
  const { logout, isAdmin, permissions, isGuest } = useSession()
  const { state: playback, refreshState } = usePlayback(!isGuest)
  const [activeTab, setActiveTab]     = useState<Tab>('browse')
  const [partyBusy, setPartyBusy] = useState(false)
  const [showGuestQR, setShowGuestQR] = useState(false)

  // ── Kiosk idle / slideshow behaviour ────────────────────────────────────
  // Return to Music tab after 45 s of no interaction on Search / Queue.
  // Advance album browser page every 18 s of idle while on Music tab.
  const RETURN_TO_BROWSE_MS = 45_000
  const SLIDESHOW_TICK_MS   = 18_000
  const lastInteractionRef  = useRef<number>(performance.now())
  const [slideshowTick, setSlideshowTick] = useState(0)

  const bumpActivity = useCallback(() => {
    lastInteractionRef.current = performance.now()
  }, [])

  // Any keypress counts as activity (physical keyboard navigation)
  useEffect(() => {
    const handler = () => bumpActivity()
    document.addEventListener('keydown', handler, { passive: true })
    return () => document.removeEventListener('keydown', handler)
  }, [bumpActivity])

  // Auto-return to browse when idle on search / queue tab
  useEffect(() => {
    if (activeTab === 'browse') return
    const id = setInterval(() => {
      if (performance.now() - lastInteractionRef.current > RETURN_TO_BROWSE_MS)
        setActiveTab('browse')
    }, 4000)
    return () => clearInterval(id)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Slideshow: advance album page when idle on browse tab
  useEffect(() => {
    if (activeTab !== 'browse') return
    const id = setInterval(() => {
      if (performance.now() - lastInteractionRef.current > SLIDESHOW_TICK_MS)
        setSlideshowTick(t => t + 1)
    }, SLIDESHOW_TICK_MS)
    return () => clearInterval(id)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drive the neon-rim breathing animation from the current track BPM
  const bpm = playback?.current_track?.bpm ?? 0
  useEffect(() => {
    const stage = document.querySelector('.kiosk-stage') as HTMLElement | null
    if (!stage) return
    // 4 beats per breath cycle, clamped to a tasteful 1.5 – 4 s range
    const beatMs = bpm > 0
      ? Math.max(1500, Math.min(4000, Math.round((60_000 / bpm) * 4)))
      : 2000
    stage.style.setProperty('--beat-ms', `${beatMs}ms`)
  }, [bpm])
  // ── End idle/slideshow ───────────────────────────────────────────────────

  // partyActive is derived from backend state so fresh login / page refresh always reflects reality.
  // partyBusy is separate — it disables the button optimistically from the moment it's clicked.
  const partyActive = !!playback?.is_party_mode

  // Listen for party events from SSE
  useSSE({
    party_started: () => { setPartyBusy(true) },
    party_ended:   () => { setPartyBusy(false) },
    user_access_revoked: () => { logout() },
    user_access_expired: () => { logout() },
  })

  // Fallback polling: if SSE is blocked by an ad blocker, poll state every 3s during party mode.
  // This ensures the overlay appears/disappears even without SSE.
  useEffect(() => {
    if (!partyActive) return
    const id = setInterval(() => refreshState().catch(console.error), 3000)
    return () => clearInterval(id)
  }, [partyActive]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCheers() {
    if (partyBusy) return
    setPartyBusy(true)
    try {
      await partyApi.cheers()
      // Immediately refresh state so overlay shows even if SSE is blocked by ad blocker
      await refreshState()
    } catch (err) {
      console.error('[party]', err)
      setPartyBusy(false)
    }
  }

  const tabs: Array<{ id: Tab; icon: React.ReactNode; label: string }> = [
    { id: 'browse', icon: <Disc3 size={18} />,    label: 'Musik' },
    { id: 'search', icon: <Search size={18} />,   label: 'Søg' },
    { id: 'queue',  icon: <ListMusic size={18} />, label: 'Kø' },
  ]

  return (
    <div className="kiosk-stage">
      <div className="kiosk-cabinet-shell" />
      <div className="kiosk-cabinet-rim" />

      <div className="kiosk-cabinet">
        <header className="kiosk-header chrome-border">
          <div className="kiosk-brand-wrap">
            <span className="kiosk-crown neon-text-amber">♛</span>
            <h1 className="kiosk-brand">CrownJukebox</h1>
          </div>
          <div className="kiosk-header-actions">
            {!isGuest && (
              <button className="btn btn-ghost btn-icon" style={{ padding: '8px' }} onClick={() => setShowGuestQR(true)} title="Gæst QR kode">
                <QrCode size={16} />
              </button>
            )}
            {isAdmin && (
              <a href="/admin" className="btn btn-ghost btn-icon" style={{ padding: '8px' }} title="Admin">
                <Settings size={16} />
              </a>
            )}
            <button className="btn btn-ghost btn-icon" style={{ padding: '8px' }} onClick={logout} title="Log ud">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="kiosk-main-grid">
          <section className="kiosk-now-playing chrome-border">
            <NowPlaying state={playback} refreshState={refreshState} />
          </section>

          <section className="kiosk-browser chrome-border" onPointerDown={bumpActivity}>
            {/* Compact retro nav shown only for search / queue tabs */}
            {activeTab !== 'browse' && (
              <div style={{
                display: 'flex', gap: '6px', padding: '6px 8px',
                background: 'var(--surface-mid)',
                borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
              }}>
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`kiosk-pill${activeTab === tab.id ? ' is-active' : ''}`}
                    style={{ fontSize: '0.72rem', padding: '6px 8px', gap: '5px' }}
                  >
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>
            )}

            <div className="kiosk-browser-content">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                  style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}
                >
                  {activeTab === 'browse' && <AlbumBrowser onSearchTab={() => setActiveTab('search')} onQueueTab={() => setActiveTab('queue')} slideshowTick={slideshowTick} />}
                  {activeTab === 'search' && <SearchScreen />}
                  {activeTab === 'queue'  && <Queue />}
                </motion.div>
              </AnimatePresence>
            </div>
          </section>
        </main>

        {(isAdmin || permissions?.can_use_party_button) && (
          <footer className="kiosk-footer">
            <button
              className="btn btn-party"
              style={{ minWidth: '280px', opacity: partyBusy ? 0.5 : 1 }}
              onClick={handleCheers}
              disabled={partyBusy}
              aria-label="SKÅL!"
            >
              🥂 SKÅL!
            </button>
          </footer>
        )}
      </div>

      {/* Party overlay — full screen */}
      <PartyOverlay
        active={partyActive}
        onClose={async () => { try { await partyApi.end() } catch {} setPartyBusy(false) }}
      />

      {/* Guest QR modal */}
      {showGuestQR && <GuestQRModal onClose={() => setShowGuestQR(false)} />}
    </div>
  )
}
