import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { NowPlaying } from '@/components/NowPlaying'
import { Queue } from '@/components/Queue'
import { AlbumBrowser } from '@/components/AlbumBrowser'
import { SearchScreen } from '@/components/SearchScreen'
import { PartyOverlay } from '@/components/PartyOverlay'
import { usePlayback } from '@/hooks/usePlayback'
import { useSession } from '@/hooks/useSession'
import { useSSE } from '@/hooks/useSSE'
import { partyApi } from '@/api/client'
import { Disc3, Search, ListMusic, LogOut } from 'lucide-react'

type Tab = 'now' | 'browse' | 'search' | 'queue'

/**
 * MobileLayout — companion layout for phones/tablets.
 * Vertical stack with tab bar at the bottom.
 * Intended to be opened by guests on their own device while the
 * kiosk runs on the main screen.
 */
export function MobileLayout() {
  const { logout, permissions, isAdmin, isGuest } = useSession()
  const { state: playback, refreshState } = usePlayback(!isGuest)
  const [activeTab, setActiveTab]     = useState<Tab>('now')
  const [partyBusy, setPartyBusy] = useState(false)

  // partyActive derived from backend state — always correct on fresh login / page refresh
  const partyActive = !!playback?.is_party_mode

  useSSE({
    party_started: () => { setPartyBusy(true) },
    party_ended:   () => { setPartyBusy(false) },
    user_access_revoked:  () => logout(),
    user_access_expired:  () => logout(),
  })

  // Fallback polling when SSE is blocked by ad blocker
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
      await refreshState()
    } catch (err) {
      console.error('[party]', err)
      setPartyBusy(false)
    }
  }

  const tabs: Array<{ id: Tab; icon: React.ReactNode; label: string }> = [
    { id: 'now',    icon: <Disc3 size={20} />,     label: 'Spiller' },
    { id: 'browse', icon: <Disc3 size={20} />,     label: 'Musik' },
    { id: 'search', icon: <Search size={20} />,    label: 'Søg' },
    { id: 'queue',  icon: <ListMusic size={20} />, label: 'Kø' },
  ]

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      background: 'radial-gradient(ellipse at 50% 0%, #1a0a30 0%, #0d0520 70%)',
      overflow: 'hidden',
    }}>
      {/* ── Header ──────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid rgba(191,0,255,0.2)',
        flexShrink: 0,
      }}>
        <span className="neon-text-primary" style={{ fontSize: '1.4rem', marginRight: 8 }}>♛</span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.85rem',
          letterSpacing: '3px',
          color: 'var(--chrome-bright)',
          textTransform: 'uppercase',
          flex: 1,
        }}>
          CrownJukebox
        </span>
        <button
          className="btn btn-ghost btn-icon"
          style={{ padding: '6px' }}
          onClick={logout}
          title="Log ud"
        >
          <LogOut size={16} />
        </button>
      </div>

      {/* ── Main content (scrollable) ────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            style={{ height: '100%', overflow: 'auto' }}
          >
            {activeTab === 'now'    && <NowPlaying state={playback} refreshState={refreshState} />}
            {activeTab === 'browse' && <AlbumBrowser />}
            {activeTab === 'search' && <SearchScreen />}
            {activeTab === 'queue'  && <Queue />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── SKÅL knap (vises over tab-bar hvis tilladelse) ── */}
      {(isAdmin || permissions?.can_use_party_button) && (
        <div style={{ padding: '8px 16px 0', flexShrink: 0 }}>
          <button
            className="btn btn-party"
            style={{ width: '100%', fontSize: '1rem', padding: '14px', opacity: partyBusy ? 0.5 : 1 }}
            onClick={handleCheers}
            disabled={partyBusy}
          >
            🥂 SKÅL!
          </button>
        </div>
      )}


      {/* ── Tab bar ─────────────────────────────────────── */}
      <nav style={{
        display: 'flex',
        borderTop: '1px solid rgba(191,0,255,0.2)',
        background: 'rgba(13,5,32,0.95)',
        flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '10px 0',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: activeTab === tab.id
                ? 'var(--neon-primary)'
                : 'rgba(255,255,255,0.4)',
              fontSize: '0.65rem',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              transition: 'color 0.15s',
            }}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <motion.div
                layoutId="mobile-tab-indicator"
                style={{
                  position: 'absolute',
                  top: 0,
                  width: '32px',
                  height: '2px',
                  background: 'var(--neon-primary)',
                  borderRadius: '0 0 2px 2px',
                  boxShadow: '0 0 8px var(--neon-primary)',
                }}
              />
            )}
          </button>
        ))}
      </nav>

      <PartyOverlay
        active={partyActive}
        onClose={async () => { try { await partyApi.end() } catch {} setPartyBusy(false) }}
      />
    </div>
  )
}
