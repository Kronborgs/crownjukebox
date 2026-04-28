import { useState } from 'react'
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
  const { logout, isAdmin, permissions } = useSession()
  const { state: playback, refreshState } = usePlayback()
  const [activeTab, setActiveTab]     = useState<Tab>('browse')
  const [partyActive, setPartyActive] = useState(false)
  const [partyBusy, setPartyBusy] = useState(false)

  // Listen for party events from SSE
  useSSE({
    party_started: () => {
      setPartyActive(true)
      setPartyBusy(true)
    },
    party_ended: () => { setPartyActive(false); setPartyBusy(false) },
    user_access_revoked: () => { logout() },
    user_access_expired: () => { logout() },
  })

  async function handleCheers() {
    if (partyBusy) return
    setPartyBusy(true)
    try {
      await partyApi.cheers()
      // SSE will broadcast party_started and keep partyBusy=true
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
            <div className="kiosk-tabbar">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`kiosk-pill ${activeTab === tab.id ? 'is-active' : ''}`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

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
                  {activeTab === 'browse' && <AlbumBrowser />}
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
        onClose={() => { setPartyActive(false); setPartyBusy(false) }}
      />
    </div>
  )
}
