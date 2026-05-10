import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { NowPlaying } from '@/components/NowPlaying'
import { AlbumBrowser } from '@/components/AlbumBrowser'
import { SearchScreen } from '@/components/SearchScreen'
import { Queue } from '@/components/Queue'
import { PartyOverlay } from '@/components/PartyOverlay'
import { usePlayback } from '@/hooks/usePlayback'
import { useSession } from '@/hooks/useSession'
import { useSSE } from '@/hooks/useSSE'
import { partyApi } from '@/api/client'
import { Search, ListMusic, Disc3, LogOut, Settings } from 'lucide-react'

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

          <section className="kiosk-browser chrome-border">
            {/* Compact retro nav shown only for search / queue tabs */}
            {activeTab !== 'browse' && (
              <div style={{
                display: 'flex', gap: '4px', padding: '5px 8px',
                background: 'linear-gradient(180deg, #1a0e04 0%, #120a02 100%)',
                borderBottom: '2px solid #4a3010', flexShrink: 0,
              }}>
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      flex: 1, padding: '7px 4px',
                      fontSize: '0.72rem', fontWeight: 800,
                      fontFamily: '"Courier New", monospace',
                      letterSpacing: '1px',
                      background: activeTab === tab.id
                        ? 'linear-gradient(160deg, #ede0a8 0%, #c9a548 100%)'
                        : 'linear-gradient(160deg, #3d2808 0%, #2a1a04 100%)',
                      color: activeTab === tab.id ? '#1a0800' : 'rgba(255,210,100,0.7)',
                      border: activeTab === tab.id ? '1px solid #8a6818' : '1px solid #4a3010',
                      borderRadius: '3px',
                      boxShadow: activeTab === tab.id
                        ? '1px 2px 0 #6a4010, inset 0 1px 0 rgba(255,255,255,0.5)'
                        : '1px 1px 0 rgba(0,0,0,0.3)',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                      transform: activeTab === tab.id ? 'translateY(1px)' : 'none',
                      transition: 'all 0.07s',
                    }}
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
                  {activeTab === 'browse' && <AlbumBrowser onSearchTab={() => setActiveTab('search')} onQueueTab={() => setActiveTab('queue')} />}
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
    </div>
  )
}
