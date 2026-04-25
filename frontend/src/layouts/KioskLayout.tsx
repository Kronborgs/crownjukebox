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
  const playback = usePlayback()
  const [activeTab, setActiveTab]     = useState<Tab>('browse')
  const [partyActive, setPartyActive] = useState(false)
  const [partyTrack, setPartyTrack]   = useState('')

  // Listen for party events from SSE
  useSSE({
    party_started: (data: unknown) => {
      const d = data as { track?: { title?: string } }
      setPartyTrack(d?.track?.title ?? '')
      setPartyActive(true)
    },
    party_ended: () => setPartyActive(false),
    user_access_revoked: () => { logout() },
    user_access_expired: () => { logout() },
  })

  async function handleCheers() {
    try {
      await partyApi.cheers()
      // SSE will broadcast party_started
    } catch (err) {
      console.error('[party]', err)
    }
  }

  const tabs: Array<{ id: Tab; icon: React.ReactNode; label: string }> = [
    { id: 'browse', icon: <Disc3 size={18} />,    label: 'Musik' },
    { id: 'search', icon: <Search size={18} />,   label: 'Søg' },
    { id: 'queue',  icon: <ListMusic size={18} />, label: 'Kø' },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '380px 1fr',
      gridTemplateRows: '1fr auto',
      height: '100vh',
      background: 'radial-gradient(ellipse at 20% 50%, #1a0a30 0%, #0d0520 60%)',
      overflow: 'hidden',
    }}>
      {/* ── Left: Now Playing ───────────────────────────── */}
      <div style={{
        gridRow: '1 / 3',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid rgba(191,0,255,0.2)',
        overflow: 'hidden',
      }}>
        {/* Logo bar */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <span className="neon-text-primary" style={{ fontSize: '1.6rem' }}>♛</span>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1rem',
            letterSpacing: '3px',
            color: 'var(--chrome-bright)',
            textTransform: 'uppercase',
          }}>
            CrownJukebox
          </span>
          <div style={{ flex: 1 }} />
          {isAdmin && (
            <a href="/admin" className="btn btn-ghost btn-icon" style={{ padding: '6px' }} title="Admin">
              <Settings size={16} />
            </a>
          )}
          <button className="btn btn-ghost btn-icon" style={{ padding: '6px' }} onClick={logout} title="Log ud">
            <LogOut size={16} />
          </button>
        </div>

        {/* Now Playing component */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <NowPlaying state={playback} />
        </div>

        {/* SKÅLE button */}
        {permissions?.can_use_party_button && (
          <div style={{ padding: '20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              className="btn btn-party"
              style={{ width: '100%' }}
              onClick={handleCheers}
              aria-label="SKÅL!"
            >
              🥂 SKÅL!
            </button>
          </div>
        )}
      </div>

      {/* ── Right: tabs ─────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'var(--bg-panel)',
          flexShrink: 0,
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '14px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--neon-primary)' : '2px solid transparent',
                color: activeTab === tab.id ? 'var(--neon-primary)' : 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: activeTab === tab.id ? 700 : 400,
                transition: 'all var(--transition-fast)',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
              style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}
            >
              {activeTab === 'browse' && <AlbumBrowser />}
              {activeTab === 'search' && <SearchScreen />}
              {activeTab === 'queue'  && <Queue />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Party overlay — full screen */}
      <PartyOverlay
        active={partyActive}
        trackTitle={partyTrack}
        onClose={() => setPartyActive(false)}
      />
    </div>
  )
}
