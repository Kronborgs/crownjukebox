import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, User, Track, Playlist, KeyboardBinding, setCurrentRoomId, JukeboxSession, FragmentedAlbumGroup, MBReleaseGroup, IncompleteTrack } from '@/api/client'
import { useSession } from '@/hooks/useSession'
import { useSSE } from '@/hooks/useSSE'
import { Plus, UserCheck, UserX, Trash2, RefreshCw, Settings, Music2, X, KeyRound, Radio, LayoutDashboard, Mail, PartyPopper, Upload, Star, ChevronUp, ChevronDown, LogOut, Monitor, Smartphone, WifiOff, AlertTriangle, Zap } from 'lucide-react'

type AdminTab = 'dashboard' | 'users' | 'jukeboxes' | 'settings' | 'library' | 'smtp' | 'youtube' | 'skaal'

export function AdminLayout() {
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const { logout } = useSession()

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(191,0,255,0.2)', display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--bg-panel)' }}>
        <span className="neon-text-primary" style={{ fontSize: '1.4rem' }}>♛</span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--chrome-bright)', flex: 1 }}>
          Admin Panel
        </h1>
        <button
          className="btn btn-ghost"
          onClick={logout}
          title="Log ud"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-dim)' }}
        >
          <LogOut size={15} /> Log ud
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'var(--bg-panel)', flexShrink: 0, overflowX: 'auto' }}>
        {([
          { id: 'dashboard', icon: <LayoutDashboard size={16} />, label: 'Dashboard' },
          { id: 'users',     icon: <UserCheck size={16} />,      label: 'Brugere' },
          { id: 'jukeboxes', icon: <Radio size={16} />,          label: 'Jukeboxes' },
          { id: 'skaal',     icon: <PartyPopper size={16} />,    label: 'SKÅL' },
          { id: 'library',   icon: <Music2 size={16} />,         label: 'Bibliotek' },
          { id: 'smtp',      icon: <Mail size={16} />,           label: 'SMTP' },
          { id: 'youtube',   icon: <span style={{ fontSize: '0.9rem' }}>▶</span>, label: 'YouTube' },
          { id: 'settings',  icon: <Settings size={16} />,       label: 'Indstillinger' },
        ] as { id: AdminTab; icon: React.ReactNode; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '12px 20px', background: 'transparent', border: 'none',
            borderBottom: tab === t.id ? '2px solid var(--neon-primary)' : '2px solid transparent',
            color: tab === t.id ? 'var(--neon-primary)' : 'var(--text-dim)',
            cursor: 'pointer', fontSize: '0.9rem', fontWeight: tab === t.id ? 700 : 400,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {tab === 'dashboard' && <DashboardPanel />}
        {tab === 'users'     && <UsersPanel />}
        {tab === 'jukeboxes' && <JukeboxesPanel />}
        {tab === 'skaal'     && <SkaalPanel />}
        <div style={{ display: tab === 'library' ? 'block' : 'none' }}><LibraryPanel /></div>
        {tab === 'smtp'      && <SmtpPanel />}
        {tab === 'youtube'   && <YouTubePanel />}
        {tab === 'settings'  && <SettingsPanel />}
      </div>
    </div>
  )
}

// ─── Dashboard panel ─────────────────────────────────────────────

function DashboardPanel() {
  const navigate = useNavigate()
  const { data: metrics, refetch: refetchMetrics } = useQuery({
    queryKey: ['system-metrics'],
    queryFn: adminApi.systemMetrics,
    refetchInterval: 5000,
  })

  const { data: jukeboxes = [], refetch: refetchJukeboxes } = useQuery({
    queryKey: ['admin-jukeboxes'],
    queryFn: adminApi.jukeboxes,
    refetchInterval: (query) => query.state.error ? false : 3000,
    retry: false,
  })

  const { data: settings = {} } = useQuery({
    queryKey: ['settings'],
    queryFn: adminApi.settings,
    staleTime: 30_000,
  })

  const directStreamUrl = ((settings as Record<string, string>)['direct_stream_url'] ?? '').trim()

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}t ${mins}m`
    if (hours > 0) return `${hours}t ${mins}m`
    return `${mins}m`
  }

  const viewJukebox = (roomId: string) => {
    setCurrentRoomId(roomId)
    navigate('/jukebox')
  }

  const activeJukeboxes = jukeboxes.filter(j => j.is_playing).length
  const partyMode = jukeboxes.filter(j => j.is_party_mode).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '4px' }}>Admin Dashboard</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
            Systemoversigt og jukebox status
          </p>
        </div>
        <button 
          className="btn btn-ghost" 
          onClick={() => { refetchMetrics(); refetchJukeboxes(); }} 
          style={{ fontSize: '0.85rem', padding: '6px 12px' }}
        >
          <RefreshCw size={14} /> Opdater
        </button>
      </div>

      {/* System Metrics Grid */}
      <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginBottom: '24px' }}>
        {/* Stream Route indicator */}
        <div className="glass-card" style={{ padding: '20px', gridColumn: '1 / -1' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
            Stream rute
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '5px 14px', borderRadius: '999px', fontSize: '0.9rem', fontWeight: 700,
              background: directStreamUrl ? 'rgba(0,255,180,0.12)' : 'rgba(255,255,255,0.07)',
              border: directStreamUrl ? '1px solid rgba(0,255,180,0.4)' : '1px solid rgba(255,255,255,0.12)',
              color: directStreamUrl ? 'var(--neon-teal)' : 'var(--text-dim)',
            }}>
              {directStreamUrl ? '⚡ Direkte' : '☁ Via Cloudflare'}
            </span>
            {directStreamUrl ? (
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {directStreamUrl}
              </span>
            ) : (
              <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>
                Ingen direkte URL konfigureret — al streamingtrafik går via Cloudflare
              </span>
            )}
          </div>
        </div>
        {/* Uptime */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            Uptime
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--neon-teal)' }}>
            {metrics ? formatUptime(metrics.uptime_seconds) : '...'}
          </div>
        </div>

        {/* Memory */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            Memory Usage
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--neon-primary)' }}>
            {metrics ? `${metrics.memory.alloc_mb} MB` : '...'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            System: {metrics?.memory.sys_mb} MB
          </div>
        </div>

        {/* CPU/Goroutines */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            Runtime
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--neon-amber)' }}>
            {metrics?.runtime.goroutines ?? '...'}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            Goroutines • {metrics?.runtime.num_cpu} CPU
          </div>
        </div>

        {/* Active Jukeboxes */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            Aktive Jukeboxes
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--neon-green)' }}>
            {activeJukeboxes} / {jukeboxes.length}
          </div>
          {partyMode > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--neon-amber)', marginTop: '4px' }}>
              🍻 {partyMode} i SKÅL mode
            </div>
          )}
        </div>
      </div>

      {/* Database Stats */}
      {metrics && (
        <div className="glass-card" style={{ padding: '20px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '16px', color: 'var(--chrome-bright)' }}>
            Bibliotek Statistik
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Tracks</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {metrics.database.tracks.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Albums</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {metrics.database.albums.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Artister</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {metrics.database.artists.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Brugere</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {metrics.database.users}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Rum</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {metrics.database.rooms}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Jukebox Overview */}
      <div>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '16px', color: 'var(--chrome-bright)' }}>
          Jukebox Oversigt
        </h3>
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {jukeboxes.map(jb => (
            <div
              key={jb.user_id}
              className="glass-card"
              style={{ padding: '14px', cursor: 'pointer', transition: 'all 0.2s' }}
              onClick={() => viewJukebox(jb.room_id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: jb.is_playing ? 'var(--neon-green)' : 'var(--text-dim)',
                    boxShadow: jb.is_playing ? '0 0 10px var(--neon-green)' : 'none',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--chrome-bright)' }}>
                    {jb.display_name}
                  </div>
                </div>
                {jb.is_party_mode && (
                  <span style={{ fontSize: '1rem' }}>🍻</span>
                )}
              </div>
              {jb.current_track && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {jb.current_track.title}
                </div>
              )}
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                {jb.queue_length} numre i kø
              </div>
            </div>
          ))}
        </div>
        {jukeboxes.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
            Ingen aktive jukeboxes
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Jukeboxes panel ─────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return `${secs}s siden`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m siden`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}t siden`
  return `${Math.floor(hours / 24)}d siden`
}

function DeviceIcon({ session }: { session: JukeboxSession }) {
  const name = session.device_name.toLowerCase()
  const isMobile = /mobile|android|iphone|ipad/i.test(name)
  return isMobile ? <Smartphone size={12} style={{ flexShrink: 0 }} /> : <Monitor size={12} style={{ flexShrink: 0 }} />
}

function JukeboxesPanel() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: jukeboxes = [], refetch } = useQuery({
    queryKey: ['admin-jukeboxes'],
    queryFn: adminApi.jukeboxes,
    refetchInterval: (query) => query.state.error ? false : 5000,
    retry: false,
  })

  const revoke = useMutation({
    mutationFn: (sessionId: string) => adminApi.revokeSession(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-jukeboxes'] }),
  })

  const viewJukebox = (roomId: string) => {
    setCurrentRoomId(roomId)
    navigate('/jukebox')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Bruger Jukeboxes</h2>
        <button className="btn btn-ghost" onClick={() => refetch()} style={{ fontSize: '0.85rem', padding: '6px 12px' }}>
          <RefreshCw size={14} /> Opdater
        </button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '24px' }}>
        Oversigt over alle brugeres jukeboxes. Opdateres automatisk hvert 5. sekund.
      </p>

      <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {jukeboxes.map((jb) => {
          const ownerSessions = jb.active_sessions.filter(s => !s.is_guest_session)
          const guestSessions = jb.active_sessions.filter(s => s.is_guest_session)
          const playingWithNoOwner = jb.is_playing && ownerSessions.length === 0

          return (
            <div
              key={jb.user_id}
              className="glass-card"
              style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative' }}
            >
              {/* Status dot */}
              <div style={{
                position: 'absolute', top: '14px', right: '14px',
                width: '11px', height: '11px', borderRadius: '50%',
                background: jb.is_playing ? 'var(--neon-green)' : 'var(--text-dim)',
                boxShadow: jb.is_playing ? '0 0 10px var(--neon-green)' : 'none',
              }} />

              {/* Header */}
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '2px' }}>
                  {jb.display_name}
                </h3>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  ID: {jb.user_id.slice(0, 8)}...
                </p>
              </div>

              {/* Warning: playing but no owner logged in */}
              {playingWithNoOwner && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  background: 'rgba(255,160,0,0.12)', border: '1px solid rgba(255,160,0,0.4)',
                  borderRadius: '6px', padding: '8px 10px', fontSize: '0.78rem', color: '#ffb347',
                }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  Afspiller — men ingen ejer er logget ind!
                </div>
              )}

              {/* Current track */}
              {jb.current_track && (
                <div style={{ padding: '8px 12px', background: 'rgba(191,0,255,0.08)', borderRadius: '6px', borderLeft: '3px solid var(--neon-primary)' }}>
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                    {jb.current_track.title}
                  </p>
                  <p style={{ fontSize: '0.72rem', color: 'var(--neon-teal)' }}>
                    {jb.current_track.artist}
                  </p>
                </div>
              )}

              {/* Status row */}
              <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <div>
                  <span style={{ color: 'var(--text-dim)' }}>Status:</span>{' '}
                  <span style={{ color: jb.is_playing ? 'var(--neon-green)' : 'var(--text-dim)' }}>
                    {jb.is_playing ? 'Afspiller' : 'Pause'}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-dim)' }}>Kø:</span>{' '}
                  <span>{jb.queue_length} numre</span>
                </div>
                {jb.is_party_mode && <span style={{ color: 'var(--neon-amber)', fontWeight: 700 }}>🍻 SKÅL</span>}
              </div>

              {/* Active sessions */}
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Aktive sessioner ({jb.active_sessions.length})
                  {ownerSessions.length > 0 && ` · ${ownerSessions.length} ejer`}
                  {guestSessions.length > 0 && ` · ${guestSessions.length} gæst`}
                </div>

                {jb.active_sessions.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-dim)', padding: '6px 0' }}>
                    <WifiOff size={12} /> Ingen indlogget
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {jb.active_sessions.map(sess => (
                      <div key={sess.id} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        background: sess.is_active_player
                          ? 'rgba(0,255,204,0.08)'
                          : sess.is_guest_session
                          ? 'rgba(255,255,255,0.03)'
                          : 'rgba(191,0,255,0.06)',
                        border: sess.is_active_player ? '1px solid rgba(0,255,204,0.3)' : '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '6px', padding: '6px 8px', fontSize: '0.75rem',
                      }}>
                        <DeviceIcon session={sess} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                              {sess.device_name || 'Ukendt enhed'}
                            </span>
                            {sess.is_guest_session && (
                              <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', padding: '1px 5px', color: 'var(--text-dim)' }}>GÆST</span>
                            )}
                            {sess.is_active_player && (
                              <span style={{ fontSize: '0.65rem', background: 'rgba(0,255,204,0.2)', borderRadius: '3px', padding: '1px 5px', color: 'var(--neon-teal)' }}>🔊 AFSPILLER</span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-dim)', marginTop: '1px' }}>
                            Logget ind {relativeTime(sess.created_at)} · sidst set {relativeTime(sess.last_seen_at)}
                          </div>
                        </div>
                        <button
                          title="Log ud denne session"
                          style={{ background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer', color: 'var(--text-dim)', flexShrink: 0, borderRadius: '4px' }}
                          onClick={() => revoke.mutate(sess.id)}
                          onMouseEnter={e => (e.currentTarget.style.color = '#ff4444')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                        >
                          <LogOut size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary"
                style={{ marginTop: '4px', fontSize: '0.85rem' }}
                onClick={() => viewJukebox(jb.room_id)}
              >
                Vis Jukebox →
              </button>
            </div>
          )
        })}
      </div>

      {jukeboxes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-dim)' }}>
          <Music2 size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <p>Ingen brugere endnu</p>
        </div>
      )}
    </div>
  )
}

// ─── Users panel ─────────────────────────────────────────────────

function UsersPanel() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [changePwUser, setChangePwUser] = useState<User | null>(null)
  const { data: users = [] } = useQuery({ queryKey: ['admin-users'], queryFn: adminApi.users })

  const disable = useMutation({
    mutationFn: (id: string) => adminApi.disableUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })
  const enable = useMutation({
    mutationFn: (id: string) => adminApi.enableUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })
  const idleUpdate = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number | null }) =>
      adminApi.updateUser(id, value === null ? { clear_idle_pause: true } : { idle_pause_after_hours: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Brugere</h2>
        <button className="btn btn-primary" style={{ gap: '6px', padding: '8px 16px' }} onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Ny bruger
        </button>
      </div>

      {showCreate && (
        <CreateUserModal onClose={() => setShowCreate(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setShowCreate(false) }} />
      )}
      {changePwUser && (
        <ChangePasswordModal user={changePwUser} onClose={() => setChangePwUser(null)} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {(users as User[]).map(user => (
          <div key={user.id} className="glass-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <p style={{ fontWeight: 600 }}>{user.display_name}</p>
                {user.role === 'admin' && <span className="badge badge-primary">admin</span>}
                {!user.is_active && <span className="badge badge-accent">deaktiveret</span>}
                {!user.is_permanent && <span className="badge badge-amber">gæst</span>}
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                {user.username} · oprettet {new Date(user.created_at).toLocaleDateString('da-DK')}
                {user.access_expires_at && ` · udløber ${new Date(user.access_expires_at).toLocaleDateString('da-DK')}`}
              </p>
              <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Pause ved inaktivitet:</span>
                <select
                  style={{ fontSize: '0.75rem', background: 'var(--bg-base, #111)', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '2px 6px' }}
                  value={user.idle_pause_after_hours ?? ''}
                  onChange={e => idleUpdate.mutate({ id: user.id, value: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Ingen (spil altid)</option>
                  <option value="1">1 time</option>
                  <option value="2">2 timer</option>
                  <option value="3">3 timer</option>
                  <option value="4">4 timer</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-ghost btn-icon" style={{ padding: '6px' }} onClick={() => setChangePwUser(user)} title="Skift kodeord">
                <KeyRound size={16} />
              </button>
              {user.is_active ? (
                <button className="btn btn-ghost btn-icon" style={{ padding: '6px' }} onClick={() => disable.mutate(user.id)} title="Deaktiver">
                  <UserX size={16} />
                </button>
              ) : (
                <button className="btn btn-ghost btn-icon" style={{ padding: '6px' }} onClick={() => enable.mutate(user.id)} title="Aktiver">
                  <UserCheck size={16} />
                </button>
              )}
              {user.role !== 'admin' && (
                <button className="btn btn-ghost btn-icon" style={{ padding: '6px', color: 'var(--neon-accent)' }}
                  onClick={() => { if (confirm(`Slet ${user.display_name}?`)) del.mutate(user.id) }} title="Slet">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Change password modal ───────────────────────────────────────

function ChangePasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (newPw.length < 4) { setError('Kodeord skal være mindst 4 tegn'); return }
    if (newPw !== confirm) { setError('Kodeordene matcher ikke'); return }
    setSaving(true); setError('')
    try {
      await adminApi.changePassword(user.id, newPw)
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Fejl ved ændring')
    } finally {
      setSaving(false)
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
  }
  const modalStyle: React.CSSProperties = {
    background: 'var(--bg-panel)', border: '1px solid rgba(191,0,255,0.3)',
    borderRadius: 'var(--radius-md)', padding: '28px', width: '100%', maxWidth: '420px',
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>Skift kodeord — {user.display_name}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        {done ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <p style={{ color: 'var(--neon-primary)', marginBottom: '16px' }}>✓ Kodeord ændret!</p>
            <button className="btn btn-primary" onClick={onClose}>Luk</button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Nyt kodeord</label>
              <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="••••" autoFocus />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Gentag kodeord</label>
              <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••" />
            </div>
            {error && <p style={{ color: 'var(--neon-accent)', fontSize: '0.85rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Annuller</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Gemmer…' : 'Skift kodeord'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── Create user modal ────────────────────────────────────────────

interface CreateUserModalProps {
  onClose: () => void
  onCreated: () => void
}

function CreateUserModal({ onClose, onCreated }: CreateUserModalProps) {
  const qc = useQueryClient()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [isPermanent, setIsPermanent] = useState(false)
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 8)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [canQueue, setCanQueue] = useState(true)
  const [canSearch, setCanSearch] = useState(true)
  const [canParty, setCanParty] = useState(true)
  const [canViewQueue, setCanViewQueue] = useState(true)
  const [idlePauseHours, setIdlePauseHours] = useState<number | null>(null)
  const [sendInvite, setSendInvite] = useState(true)
  const [error, setError] = useState('')
  const [inviteInfo, setInviteInfo] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) { setError('Navn er påkrævet'); return }
    setSaving(true)
    setError('')
    setInviteInfo('')
    try {
      const result = await adminApi.createUser({
        display_name: displayName.trim(),
        email: email.trim() || undefined,
        pin: pin || undefined,
        role,
        is_permanent: isPermanent,
        access_expires_at: (!isPermanent && expiresAt) ? new Date(expiresAt).toISOString() : undefined,
        can_add_to_queue: canQueue,
        can_search: canSearch,
        can_use_party_button: canParty,
        can_view_queue: canViewQueue,
        idle_pause_after_hours: idlePauseHours ?? undefined,
        send_invite: !!(email.trim() && sendInvite),
      })
      if (result?.invite_error) {
        setInviteInfo(`⚠️ Bruger oprettet, men invitation fejlede: ${result.invite_error}`)
        setTimeout(onCreated, 2000)
      } else if (result?.invite_sent) {
        setInviteInfo(`✅ Invitation sendt til ${email}!`)
        setTimeout(onCreated, 1200)
      } else {
        onCreated()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Fejl ved oprettelse')
    } finally {
      setSaving(false)
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  }
  const modalStyle: React.CSSProperties = {
    background: 'var(--bg-panel)',
    border: '1px solid rgba(191,0,255,0.3)',
    borderRadius: 'var(--radius-md)',
    padding: '28px',
    width: '100%',
    maxWidth: '480px',
    maxHeight: '90vh',
    overflowY: 'auto',
  }
  const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px' }
  const labelStyle: React.CSSProperties = { fontSize: '0.85rem', color: 'var(--text-secondary)' }
  const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>Opret bruger</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={rowStyle}>
            <label style={labelStyle}>Navn *</label>
            <input className="input" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Gæst 1" autoFocus />
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>E-mail (til invitation)</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="gaest@example.com" />
          </div>
          {email.trim() && (
            <label style={checkRow}>
              <input type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} />
              <span style={labelStyle}>📧 Send festlig invitation via e-mail</span>
            </label>
          )}
          <div style={rowStyle}>
            <label style={labelStyle}>PIN (valgfrit)</label>
            <input className="input" type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" inputMode="numeric" />
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Rolle</label>
            <select className="input" value={role} onChange={e => setRole(e.target.value as 'user' | 'admin')}>
              <option value="user">Bruger</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <label style={checkRow}>
            <input type="checkbox" checked={isPermanent} onChange={e => setIsPermanent(e.target.checked)} />
            <span style={labelStyle}>Permanent bruger (ingen udløbsdato)</span>
          </label>
          {!isPermanent && (
            <div style={rowStyle}>
              <label style={labelStyle}>Adgang udløber</label>
              <input
                className="input"
                type="datetime-local"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                min={(() => { const d = new Date(); const pad = (n: number) => String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` })()}
              />
            </div>
          )}
          <div style={rowStyle}>
            <label style={labelStyle}>Automatisk pause ved inaktivitet</label>
            <select
              className="input"
              value={idlePauseHours ?? ''}
              onChange={e => setIdlePauseHours(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Ingen (spil altid)</option>
              <option value="1">1 time</option>
              <option value="2">2 timer</option>
              <option value="3">3 timer</option>
              <option value="4">4 timer</option>
            </select>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
            <p style={{ ...labelStyle, marginBottom: '10px', fontWeight: 600 }}>Rettigheder</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { label: 'Kan tilføje til kø',    val: canQueue,     set: setCanQueue },
                { label: 'Kan søge',               val: canSearch,    set: setCanSearch },
                { label: 'Kan bruge SKÅLE-knap',   val: canParty,     set: setCanParty },
                { label: 'Kan se køen',            val: canViewQueue, set: setCanViewQueue },
              ].map(({ label, val, set }) => (
                <label key={label} style={checkRow}>
                  <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} />
                  <span style={labelStyle}>{label}</span>
                </label>
              ))}
            </div>
          </div>
          {error && <p style={{ color: 'var(--neon-accent)', fontSize: '0.85rem' }}>{error}</p>}
          {inviteInfo && <p style={{ color: inviteInfo.startsWith('✅') ? 'var(--neon-teal, #22d3a0)' : 'orange', fontSize: '0.85rem' }}>{inviteInfo}</p>}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuller</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Opretter…' : (email.trim() && sendInvite ? 'Opret & send invitation' : 'Opret bruger')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Library panel ────────────────────────────────────────────────

function PartyPlaylistTracks({ playlistId, isActive }: { playlistId: string; isActive: boolean }) {
  const qc = useQueryClient()
  const { data: tracks = [] } = useQuery({
    queryKey: ['playlist-tracks', playlistId],
    queryFn: () => adminApi.playlistTracks(playlistId)
  })

  // Determine intro order numbers (intros appear in the order they sit in the playlist)
  let introCounter = 0

  async function toggleIntro(trackId: string, currentIsIntro: boolean) {
    await adminApi.setIntroTrack(playlistId, trackId, !currentIsIntro)
    qc.invalidateQueries({ queryKey: ['playlist-tracks', playlistId] })
  }

  async function removeTrack(trackId: string, title: string) {
    if (!confirm(`Fjern "${title}" fra playlisten?`)) return
    await adminApi.removePlaylistTrack(playlistId, trackId)
    qc.invalidateQueries({ queryKey: ['playlist-tracks', playlistId] })
    qc.invalidateQueries({ queryKey: ['admin-playlists'] })
  }

  if (tracks.length === 0) {
    return <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '12px' }}>Ingen numre i playlisten endnu.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
      {isActive && (
        <p style={{ fontSize: '0.75rem', color: 'var(--neon-amber)', marginBottom: '6px' }}>
          ✓ = Intro-nummer (alle intros spilles i rækkefølge, derefter EN tilfældig sang → normal kø)
        </p>
      )}
      {tracks.map(t => {
        const isIntro = !!t.is_intro
        if (isIntro) introCounter++
        const introNum = isIntro ? introCounter : 0
        return (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              background: isIntro ? 'rgba(191,0,255,0.1)' : 'rgba(255,255,255,0.04)',
              borderRadius: '6px',
              border: isIntro ? '1px solid var(--neon-primary)' : '1px solid transparent'
            }}
          >
            <button
              onClick={() => toggleIntro(t.id, isIntro)}
              style={{
                width: '28px',
                height: '24px',
                borderRadius: '4px',
                border: isIntro ? '2px solid var(--neon-primary)' : '2px solid rgba(255,255,255,0.3)',
                background: isIntro ? 'var(--neon-primary)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                fontSize: '12px',
                fontWeight: 700,
                color: isIntro ? 'var(--bg-base)' : 'rgba(255,255,255,0.4)'
              }}
              title={isIntro ? `Intro #${introNum} — klik for at fjerne` : 'Klik for at gøre til intro'}
            >
              {isIntro ? introNum : ''}
            </button>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t.title}</p>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{t.artist}</p>
            </div>
            <button
              className="btn btn-ghost"
              style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--neon-red)' }}
              onClick={() => removeTrack(t.id, t.title)}
              title="Fjern fra playliste"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── BPM stats bar ───────────────────────────────────────────
function BpmStatsBar({ withBPM, withoutBPM }: { withBPM: number; withoutBPM: number }) {
  const total = withBPM + withoutBPM
  const pct = total > 0 ? Math.round((withBPM / total) * 100) : 0
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>BPM-data</span>
        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--neon-teal)', fontWeight: 700 }}>{withBPM.toLocaleString()} har BPM</span>
          <span style={{ color: 'var(--text-dim)' }}> / {total.toLocaleString()} numre i alt ({pct}%)</span>
        </span>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden', height: '6px' }}>
        <div style={{ background: 'linear-gradient(90deg, var(--neon-teal), #60e0b0)', height: '100%', width: `${pct}%`, transition: 'width 0.4s ease', borderRadius: '4px' }} />
      </div>
      {withoutBPM > 0 && (
        <p style={{ fontSize: '0.72rem', color: 'var(--neon-amber, #ffaa00)', marginTop: '5px' }}>
          {withoutBPM.toLocaleString()} numre har ikke BPM i tags og tonehøjde-analyse fandt intet — brug "Scan manglende" for at prøve igen
        </p>
      )}
    </div>
  )
}

// ─── Disk stats bar ───────────────────────────────────────────
function DiskStatsBar({ sizeBytes, fileCount, totalDurationSecs }: { sizeBytes: number; fileCount: number; totalDurationSecs: number }) {
  const fmt = (b: number) => {
    if (b >= 1024 ** 4) return (b / 1024 ** 4).toFixed(1) + ' TB'
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + ' GB'
    return (b / 1024 ** 2).toFixed(0) + ' MB'
  }
  const totalHours = Math.round(totalDurationSecs / 3600)
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Musikmappe</span>
        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--neon-teal)', fontWeight: 700 }}>{fmt(sizeBytes)}</span>
          <span style={{ color: 'var(--text-dim)' }}> &mdash; {fileCount.toLocaleString()} lydfiler</span>
        </span>
      </div>
      {totalHours > 0 && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '5px' }}>
          {totalHours} timers musik i biblioteket
        </p>
      )}
    </div>
  )
}

// ─── Library panel ───────────────────────────────────────────
function LibraryPanel() {
  const qc = useQueryClient()
  const [scanStatus, setScanStatus] = useState('')
  const [scanProgress, setScanProgress] = useState<{ scanned: number; total: number; currentFile: string } | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [isArtworkScanning, setIsArtworkScanning] = useState(false)
  const [artworkProgress, setArtworkProgress] = useState<{ processed: number; total: number } | null>(null)
  const [isBPMScanning, setIsBPMScanning] = useState(false)
  const [bpmProgress, setBpmProgress] = useState<{ processed: number; total: number } | null>(null)
  const [bpmScanMode, setBpmScanMode] = useState<'missing' | 'all'>('missing')
  const [isResetting, setIsResetting] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const { data: metrics } = useQuery({ queryKey: ['system-metrics'], queryFn: adminApi.systemMetrics, refetchInterval: 10000 })
  const { data: playlists = [] } = useQuery({ queryKey: ['admin-playlists'], queryFn: adminApi.skaalPlaylists })
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [uploadingPartyFiles, setUploadingPartyFiles] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Restore scan state on mount (e.g. after logout/login while server was scanning)
  useEffect(() => {
    adminApi.scanStatus().then(s => {
      if (s.library_scanning) {
        setIsScanning(true)
        if (s.library_progress) {
          setScanProgress({ scanned: s.library_progress.scanned, total: s.library_progress.total, currentFile: s.library_progress.current_file })
        }
      }
      if (s.artwork_scanning) {
        setIsArtworkScanning(true)
        if (s.artwork_progress) {
          setArtworkProgress({ processed: s.artwork_progress.processed, total: s.artwork_progress.total })
        }
      }
      if (s.bpm_scanning) {
        setIsBPMScanning(true)
        if (s.bpm_progress) {
          setBpmProgress({ processed: s.bpm_progress.processed, total: s.bpm_progress.total })
        }
      }
    }).catch(() => {})
  }, [])

  useSSE({
    artwork_scan_progress: (data) => {
      const p = data as { total: number; processed: number; done?: boolean }
      if (p.done) {
        setScanStatus(`Album covers opdateret — ${p.total} album behandlet`)
        setArtworkProgress(null)
        setIsArtworkScanning(false)
        qc.invalidateQueries({ queryKey: ['system-metrics'] })
        return
      }
      setIsArtworkScanning(true)
      setArtworkProgress({ processed: p.processed, total: p.total })
    },
    bpm_scan_progress: (data) => {
      const p = data as { total: number; processed: number; done?: boolean; error?: string }
      if (p.done || p.error) {
        setScanStatus(p.error ? `BPM-fejl: ${p.error}` : `BPM-analyse færdig — ${p.total} numre behandlet`)
        setBpmProgress(null)
        setIsBPMScanning(false)
        qc.invalidateQueries({ queryKey: ['system-metrics'] })
        return
      }
      setBpmProgress({ processed: p.processed, total: p.total })
    },
    library_scan_progress: (data) => {
      const p = data as { total: number; scanned: number; current_file?: string; done?: boolean; error?: string }
      if (p.error) {
        setScanStatus(`Fejl under scanning: ${p.error}`)
        setScanProgress(null)
        setIsScanning(false)
        return
      }
      if (p.done) {
        setScanStatus(`Scanning færdig — ${p.total} filer behandlet. Søger album covers...`)
        setScanProgress(null)
        setIsScanning(false)
        qc.invalidateQueries({ queryKey: ['system-metrics'] })
        qc.invalidateQueries({ queryKey: ['admin-jukeboxes'] })
        return
      }
      setScanProgress({ scanned: p.scanned, total: p.total, currentFile: p.current_file ?? '' })
      setScanStatus('')
    },
  })

  async function rescan() {
    setScanStatus('')
    setScanProgress(null)
    setIsScanning(true)
    try {
      await adminApi.rescan()
    } catch { setScanStatus('Fejl ved scanning'); setIsScanning(false) }
  }

  async function resetLibrary() {
    setResetConfirm(false)
    setIsResetting(true)
    setScanStatus('')
    try {
      const res = await adminApi.resetLibrary()
      setScanStatus(res.message)
      qc.invalidateQueries({ queryKey: ['system-metrics'] })
      qc.invalidateQueries({ queryKey: ['admin-playlists'] })
    } catch (err: unknown) {
      setScanStatus(err instanceof Error ? err.message : 'Nulstilling fejlede')
    } finally {
      setIsResetting(false)
    }
  }

  async function rescanArtwork() {
    setScanStatus('')
    setArtworkProgress(null)
    setIsArtworkScanning(true)
    try {
      await adminApi.rescanArtwork()
    } catch { setScanStatus('Fejl ved cover-scanning'); setIsArtworkScanning(false) }
  }

  async function analyzeBPM() {
    setScanStatus('')
    setBpmProgress(null)
    setBpmScanMode('missing')
    setIsBPMScanning(true)
    try {
      await adminApi.analyzeBPM()
    } catch { setScanStatus('Fejl ved BPM-analyse'); setIsBPMScanning(false) }
  }

  async function analyzeAllBPM() {
    setScanStatus('')
    setBpmProgress(null)
    setBpmScanMode('all')
    setIsBPMScanning(true)
    try {
      await adminApi.analyzeAllBPM()
    } catch { setScanStatus('Fejl ved BPM-analyse'); setIsBPMScanning(false) }
  }

  async function createPlaylist() {
    if (!newPlaylistName.trim()) return
    await adminApi.createPlaylist(newPlaylistName.trim())
    qc.invalidateQueries({ queryKey: ['admin-playlists'] })
    qc.invalidateQueries({ queryKey: ['skaal-playlists'] })
    setNewPlaylistName('')
  }

  async function setPartyPlaylist(id: string, isParty: boolean) {
    await adminApi.updatePlaylist(id, isParty)
    qc.invalidateQueries({ queryKey: ['admin-playlists'] })
    qc.invalidateQueries({ queryKey: ['skaal-playlists'] })
  }

  async function deletePlaylist(id: string, name: string) {
    try {
      if (!confirm(`Slet playlisten "${name}"? Dette kan ikke fortrydes.`)) return
      
      console.log('[deletePlaylist] Sletter playlist:', id, name)
      await adminApi.deletePlaylist(id)
      console.log('[deletePlaylist] Playlist slettet, opdaterer liste')
      await qc.invalidateQueries({ queryKey: ['admin-playlists'] })
      await qc.invalidateQueries({ queryKey: ['skaal-playlists'] })
      setScanStatus(`Playlisten "${name}" er slettet`)
    } catch (err: unknown) {
      console.error('[deletePlaylist] Fejl:', err)
      const errorMsg = err instanceof Error ? err.message : 'Kunne ikke slette playliste'
      setScanStatus(errorMsg)
      alert(`Fejl ved sletning: ${errorMsg}`)
    }
  }

  async function uploadPartyFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingPartyFiles(true)
    setScanStatus('Uploader SKÅLE-filer…')
    try {
      const result = await adminApi.uploadPartyPlaylistTracks(Array.from(files))
      qc.invalidateQueries({ queryKey: ['admin-playlists'] })
      qc.invalidateQueries({ queryKey: ['playlist-tracks'] })
      setScanStatus(`${result.uploaded.length} fil(er) lagt i den globale SKÅLE-playliste`)
    } catch (err: unknown) {
      setScanStatus(err instanceof Error ? err.message : 'Upload fejlede')
    } finally {
      setUploadingPartyFiles(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px' }}>Musikbibliotek</h2>
      <div style={{ display: 'flex', gap: '40px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── Venstre: normale handlinger ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '300px', maxWidth: '400px' }}>
        <button
          className="btn btn-primary"
          style={{ justifyContent: 'flex-start', gap: '10px' }}
          onClick={rescan}
          disabled={isScanning}
        >
          <RefreshCw size={16} className={isScanning ? 'spinning' : ''} /> Scan musikmappe
        </button>
        {/* ── Scan progress — shown right under the button so it's immediately visible ── */}
        {scanProgress && (
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
              <span style={{
                fontFamily: 'monospace',
                fontSize: '1.8rem',
                fontWeight: 700,
                color: 'var(--neon-primary)',
                lineHeight: 1,
                transition: 'all 0.2s ease',
              }}>
                {scanProgress.scanned}
              </span>
              {scanProgress.total > 0 && (
                <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                  / {scanProgress.total} sange
                </span>
              )}
              {scanProgress.total > 0 && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: 'auto' }}>
                  {Math.round((scanProgress.scanned / scanProgress.total) * 100)}%
                </span>
              )}
            </div>
            {scanProgress.total > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden', height: '8px', marginBottom: '8px' }}>
                <div style={{
                  background: 'linear-gradient(90deg, var(--neon-primary), var(--neon-teal))',
                  height: '100%',
                  width: `${Math.round((scanProgress.scanned / Math.max(1, scanProgress.total)) * 100)}%`,
                  transition: 'width 0.3s ease',
                  borderRadius: '4px',
                }} />
              </div>
            )}
            {scanProgress.currentFile && (
              <p style={{
                fontSize: '0.72rem',
                color: 'var(--text-dim)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {scanProgress.currentFile}
              </p>
            )}
          </div>
        )}
        {scanStatus && !isScanning && (
          <p style={{ color: scanStatus.startsWith('Fejl') ? 'var(--neon-amber)' : 'var(--neon-teal)', fontSize: '0.85rem' }}>{scanStatus}</p>
        )}
        <button
          className="btn btn-ghost"
          style={{ justifyContent: 'flex-start', gap: '10px' }}
          onClick={rescanArtwork}
          disabled={isArtworkScanning}
        >
          <RefreshCw size={16} className={isArtworkScanning ? 'spinning' : ''} /> Genindlæs album covers
        </button>
        {artworkProgress && artworkProgress.total > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '1.8rem', fontWeight: 700, color: 'var(--neon-teal)', lineHeight: 1 }}>
                {artworkProgress.processed}
              </span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>/ {artworkProgress.total} album</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden', height: '8px' }}>
              <div style={{
                background: 'linear-gradient(90deg, var(--neon-teal), var(--neon-primary))',
                height: '100%',
                width: `${Math.round((artworkProgress.processed / Math.max(1, artworkProgress.total)) * 100)}%`,
                transition: 'width 0.3s ease',
                borderRadius: '4px',
              }} />
            </div>
          </div>
        )}
        {/* ── BPM stats ── */}
        {metrics && metrics.bpm.with_bpm + metrics.bpm.without_bpm > 0 && (
          <BpmStatsBar withBPM={metrics.bpm.with_bpm} withoutBPM={metrics.bpm.without_bpm} />
        )}
        {/* ── Disk stats ── */}
        {metrics && metrics.disk.size_bytes > 0 && (
          <DiskStatsBar
            sizeBytes={metrics.disk.size_bytes}
            fileCount={metrics.disk.file_count}
            totalDurationSecs={metrics.database.total_duration_secs}
          />
        )}
        {/* ── BPM buttons ── */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1, justifyContent: 'flex-start', gap: '8px', fontSize: '0.85rem' }}
            onClick={analyzeBPM}
            disabled={isBPMScanning}
            title="Analyser kun numre der mangler BPM"
          >
            <Zap size={15} className={isBPMScanning && bpmScanMode === 'missing' ? 'spinning' : ''} />
            {isBPMScanning && bpmScanMode === 'missing' ? 'Analyserer…' : 'Scan manglende BPM'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ flex: 1, justifyContent: 'flex-start', gap: '8px', fontSize: '0.85rem' }}
            onClick={analyzeAllBPM}
            disabled={isBPMScanning}
            title="Nulstil og re-analyser BPM for alle numre"
          >
            <Zap size={15} className={isBPMScanning && bpmScanMode === 'all' ? 'spinning' : ''} />
            {isBPMScanning && bpmScanMode === 'all' ? 'Re-analyserer alle…' : 'Genanalyser alle BPM'}
          </button>
        </div>
        {bpmProgress && bpmProgress.total > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '1.8rem', fontWeight: 700, color: '#f0e060', lineHeight: 1 }}>
                {bpmProgress.processed}
              </span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>/ {bpmProgress.total} numre</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden', height: '8px' }}>
              <div style={{
                background: 'linear-gradient(90deg, #f0e060, #ffaa00)',
                height: '100%',
                width: `${Math.round((bpmProgress.processed / Math.max(1, bpmProgress.total)) * 100)}%`,
                transition: 'width 0.3s ease',
                borderRadius: '4px',
              }} />
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.flac,.ogg,.m4a,audio/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => uploadPartyFiles(e.target.files)}
        />
        <button
          className="btn btn-ghost"
          style={{ justifyContent: 'flex-start', gap: '10px' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingPartyFiles}
        >
          <Plus size={16} /> {uploadingPartyFiles ? 'Uploader filer…' : 'Upload filer til SKÅL!'}
        </button>
        </div>{/* end left column */}

        {/* ── Højre: farezone ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '260px', maxWidth: '380px' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,68,68,0.7)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px' }}>
            ⚠ Farezone
          </p>
          {!resetConfirm ? (
            <button
              className="btn btn-ghost"
              style={{ justifyContent: 'flex-start', gap: '10px', color: 'var(--neon-red, #ff4444)', borderColor: 'rgba(255,68,68,0.3)' }}
              onClick={() => setResetConfirm(true)}
              disabled={isScanning || isResetting}
            >
              <Trash2 size={16} /> Nulstil bibliotek (slet &amp; scann igen)
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255,68,68,0.5)', background: 'rgba(255,68,68,0.08)' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--neon-amber, #ffaa00)' }}>Sletter alle numre, albums og mappe-playlister. Kan ikke fortrydes.</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-ghost" style={{ fontSize: '0.8rem', color: 'var(--neon-red, #ff4444)' }} onClick={resetLibrary} disabled={isResetting}>
                  {isResetting ? 'Nulstiller…' : 'Ja, nulstil'}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setResetConfirm(false)}>Annuller</button>
              </div>
            </div>
          )}
          <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            Brug denne inden scanning hvis du vil starte fra bunden. SKÅL!-playlister bevares.
          </p>
        </div>
      </div>{/* end two-column row */}

      {/* ── Broken files ── */}
      <BrokenFilesPanel />

      {/* ── Disk analysis ── */}
      <DiskAnalysisPanel />

      {/* ── Incomplete metadata ── */}
      <IncompleteMetadataPanel />

      {/* ── Album Fixer ── */}
      <AlbumFixerPanel />

      {/* Playlist management */}
      <div style={{ marginTop: '32px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', color: 'var(--chrome-bright)' }}>
          🍻 SKÅL!
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '12px' }}>
          <strong>SKÅL!-knappen overstyrer al musik</strong> — når nogen trykker på den, pauses den nuværende kø, 
          og systemet spiller alle <strong>intro-numre</strong> i rækkefølge (markeret med nummer), derefter ét <strong>tilfældigt nummer</strong> 
          fra playlisten. Bagefter fortsætter den normale kø hvor den slap.
        </p>
        <p style={{ fontSize: '0.8rem', color: 'var(--neon-amber)', marginBottom: '16px' }}>
          💡 Upload filer permanent med knappen ovenfor. Marker numre som intro ved at klikke checkmark-knappen — nummeret viser rækkefølgen.
          Kun én playliste kan være aktiv SKÅL!-playliste.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '600px' }}>
          {(playlists as import('@/api/client').Playlist[]).map(pl => {
            console.log('[LibraryPanel] Playlist:', pl)
            return (
            <div key={pl.ID} className="glass-card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{pl.Name}</p>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>ID: {pl.ID}</p>
                </div>
                <button
                  className={pl.IsPartyPlaylist ? 'btn btn-primary' : 'btn btn-ghost'}
                  style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                  onClick={() => setPartyPlaylist(pl.ID, !pl.IsPartyPlaylist)}
                >
                  {pl.IsPartyPlaylist ? '★ Aktiv SKÅL!' : 'Brug til SKÅL!'}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '6px 10px', fontSize: '0.8rem', color: 'var(--neon-red)' }}
                  onClick={() => deletePlaylist(pl.ID, pl.Name)}
                  title="Slet playliste"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <PartyPlaylistTracks playlistId={pl.ID} isActive={pl.IsPartyPlaylist} />
            </div>
            )
          })}
        </div>

        {/* Opret ny playliste */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', maxWidth: '600px' }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Opret ny playliste…"
            value={newPlaylistName}
            onChange={e => setNewPlaylistName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createPlaylist()}
          />
          <button className="btn btn-primary" onClick={createPlaylist}>
            <Plus size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Album Fixer panel (MusicBrainz) ───────────────────────────

// Returns the artist name extracted from a file-path directory by walking up
// the path and looking for the first "Artist - Album" folder name.
// Skips known disc subfolders (CD1, Disc 2, …).
function extractArtistFromDir(dir: string): string {
  if (!dir) return ''
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)

  // Step 1: skip disc/CD subfolders from the innermost end (CD1, Disc 2, …)
  let i = parts.length - 1
  while (i >= 0 && /^(?:cd|disc|disk)\s*\d+$/i.test(parts[i])) i--

  // Step 2: skip the album folder itself
  i--

  // Step 3: walk outward until we find a useful artist-like segment
  while (i >= 0) {
    const seg = parts[i]
    const sep = seg.indexOf(' - ')
    const candidate = sep > 0 ? seg.substring(0, sep).trim() : seg
    // Skip bare years (1900–2099) and common filesystem root names
    if (
      /^\d{4}$/.test(candidate) ||
      /^(?:music|media|audio|library|storage|files?|mnt|srv|home|data|nas)$/i.test(candidate)
    ) { i--; continue }
    return candidate
  }
  return ''
}

// Returns a human-readable shortened path, e.g.:
//   /music/Aerosmith/Aerosmith - Gold/CD2  →  Aerosmith › Aerosmith - Gold › CD2
function shortDir(dir: string): string {
  if (!dir) return ''
  const parts = dir.replace(/\\/g, '/').replace(/^\/music\/?/, '').split('/').filter(Boolean)
  return parts.slice(-3).join(' › ')
}

function AlbumFixerPanel() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<FragmentedAlbumGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [writeFiles, setWriteFiles] = useState(false)
  const [searching, setSearching] = useState<Record<string, boolean>>({})
  const [mbResults, setMbResults] = useState<Record<string, MBReleaseGroup[]>>({})
  const [albumInput, setAlbumInput] = useState<Record<string, string>>({})
  const [artistInput, setArtistInput] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<Record<string, boolean>>({})
  const [mergeMsg, setMergeMsg] = useState<Record<string, string>>({})
  const [autoSearchRunning, setAutoSearchRunning] = useState(false)
  const autoSearchCancelRef = useRef(false)

  async function load() {
    setLoading(true)
    try {
      const data = await adminApi.fragmentedAlbums()
      setGroups(data)
      const initAlbum: Record<string, string> = {}
      const initArtist: Record<string, string> = {}
      data.forEach(g => {
        const dir = g.directories?.find(d => !!d) ?? ''
        initAlbum[g.title] = g.title
        initArtist[g.title] = extractArtistFromDir(dir)
      })
      setAlbumInput(initAlbum)
      setArtistInput(initArtist)
    } finally {
      setLoading(false)
    }
  }

  async function search(group: FragmentedAlbumGroup) {
    const key = group.title
    let searchTitle = albumInput[key]?.trim() || group.title
    let searchArtist = artistInput[key]?.trim()
      || extractArtistFromDir(group.directories?.find(d => !!d) ?? '')

    // Auto-parse "Artist - Album" shorthand typed into the album field.
    // Only overrides the artist part if the artist field is currently empty.
    const sep = searchTitle.indexOf(' - ')
    if (sep > 0) {
      const parsedArtist = searchTitle.slice(0, sep).trim()
      const parsedTitle = searchTitle.slice(sep + 3).trim()
      if (parsedTitle) {
        searchTitle = parsedTitle
        setAlbumInput(a => ({ ...a, [key]: parsedTitle }))
        if (!artistInput[key]?.trim()) {
          searchArtist = parsedArtist
          setArtistInput(a => ({ ...a, [key]: parsedArtist }))
        }
      }
    }

    setSearching(s => ({ ...s, [key]: true }))
    try {
      const results = await adminApi.musicBrainzSearch(searchTitle, searchArtist || undefined)
      setMbResults(r => ({ ...r, [key]: results }))
      if (results.length > 0 && !artistInput[key]?.trim()) {
        setArtistInput(a => ({ ...a, [key]: results[0].artist_name }))
      }
    } finally {
      setSearching(s => ({ ...s, [key]: false }))
    }
  }

  async function merge(group: FragmentedAlbumGroup) {
    const artist = artistInput[group.title]?.trim()
    if (!artist) return
    setMerging(m => ({ ...m, [group.title]: true }))
    try {
      const res = await adminApi.mergeAlbums(group.album_ids, artist, writeFiles)
      const tagNote = res.tag_errors?.length > 0
        ? ` (${res.tag_errors.length} filer fejlede)`
        : res.tags_written ? ' — tags skrevet' : ''
      setMergeMsg(m => ({ ...m, [group.title]: `✓ Flettet${tagNote}` }))
      setGroups(g => g.filter(x => x.title !== group.title))
      qc.invalidateQueries({ queryKey: ['system-metrics'] })
    } catch {
      setMergeMsg(m => ({ ...m, [group.title]: '✗ Fejl ved fletning' }))
    } finally {
      setMerging(m => ({ ...m, [group.title]: false }))
    }
  }

  async function searchAll() {
    if (autoSearchRunning) {
      autoSearchCancelRef.current = true
      setAutoSearchRunning(false)
      return
    }
    setAutoSearchRunning(true)
    autoSearchCancelRef.current = false
    for (const g of groups) {
      if (autoSearchCancelRef.current) break
      if (mbResults[g.title]?.length > 0) continue // already searched
      await search(g)
      if (!autoSearchCancelRef.current) await new Promise(r => setTimeout(r, 1200)) // ~1 req/s
    }
    setAutoSearchRunning(false)
  }

  return (
    <div style={{ marginTop: '28px', marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: open ? '14px' : 0, cursor: 'pointer' }} onClick={() => { setOpen(o => !o); if (!open && groups.length === 0) load() }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--neon-primary)', margin: 0, userSelect: 'none' }}>
          🎵 Album Fixer
        </h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          {open ? '▲ skjul' : '▼ find splittede album (MusicBrainz)'}
        </span>
      </div>

      {open && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '12px' }}>
            Album der er splittet fordi sange har forskellig Artist-tag. Søg på MusicBrainz for at finde det rigtige album-kunstner-navn, og flet dem bagefter.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'spinning' : ''} /> {loading ? 'Henter…' : 'Opdater liste'}
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '0.8rem', color: autoSearchRunning ? 'var(--neon-amber)' : 'var(--neon-teal)' }}
              onClick={searchAll}
              disabled={groups.length === 0 && !autoSearchRunning}
              title="Søg alle album på MusicBrainz ét ad gangen (1/sek)">
              {autoSearchRunning
                ? <><RefreshCw size={13} className="spinning" /> Stop søgning</>
                : <>&#128269; Søg alle med MusicBrainz</>}
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '0.8rem', color: 'var(--neon-teal)' }}
              onClick={() => setArtistInput(a => {
                const next = { ...a }
                groups.forEach(g => { next[g.title] = 'Various Artists' })
                return next
              })}
              disabled={groups.length === 0}
              title="Udfyld 'Various Artists' på alle album på én gang"
            >
              Sæt alle → Various Artists
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--neon-amber)', cursor: 'pointer' }}>
              <input type="checkbox" checked={writeFiles} onChange={e => setWriteFiles(e.target.checked)} />
              Skriv tags til filer (AlbumArtist)
            </label>
            {groups.length > 0 && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{groups.length} splittede album</span>
            )}
          </div>

          {groups.length === 0 && !loading && (
            <p style={{ fontSize: '0.82rem', color: 'var(--neon-teal)' }}>✓ Ingen splittede album fundet.</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto' }}>
            {groups.map(g => (
              <div key={g.title} style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '180px' }}>
                    <p style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 2px' }}>{g.title}</p>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', margin: 0 }}>
                      {g.fragment_count} dele · {g.total_tracks} numre
                    </p>
                    {g.directories?.some(d => d) && (() => {
                      const unique = [...new Set(g.directories.filter(d => d).map(shortDir))]
                      return (
                        <p
                          style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', margin: '2px 0 0', fontFamily: 'monospace',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}
                          title={g.directories.filter(d => d).join('\n')}
                        >
                          📁 {unique.join('  ·  ')}
                        </p>
                      )
                    })()}
                  </div>

                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '0.78rem', flexShrink: 0 }}
                    onClick={() => search(g)}
                    disabled={searching[g.title]}
                  >
                    {searching[g.title] ? <RefreshCw size={12} className="spinning" /> : '🔍'} MusicBrainz
                  </button>
                </div>

                {mbResults[g.title] && mbResults[g.title].length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {mbResults[g.title].map(r => (
                      <button
                        key={r.id}
                        className="btn btn-ghost"
                        style={{
                          fontSize: '0.75rem',
                          padding: '3px 8px',
                          borderColor: (artistInput[g.title] === r.artist_name && albumInput[g.title] === r.title) ? 'var(--neon-primary)' : undefined,
                          color: (artistInput[g.title] === r.artist_name && albumInput[g.title] === r.title) ? 'var(--neon-primary)' : undefined,
                        }}
                        title={`${r.artist_name || '—'}${r.compilation ? ' (kompilation)' : ''}`}
                        onClick={() => {
                          setArtistInput(a => ({ ...a, [g.title]: r.artist_name }))
                          setAlbumInput(a => ({ ...a, [g.title]: r.title }))
                        }}
                      >
                        {r.title} {r.compilation ? '(kompilation)' : ''} · {r.score}%
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={albumInput[g.title] ?? g.title}
                    onChange={e => setAlbumInput(a => ({ ...a, [g.title]: e.target.value }))}
                    placeholder="Album titel  (eller: Kunstner - Album)"
                    style={{
                      flex: 2, minWidth: '160px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      color: 'inherit',
                      fontSize: '0.82rem',
                    }}
                  />
                  <input
                    type="text"
                    value={artistInput[g.title] ?? ''}
                    onChange={e => setArtistInput(a => ({ ...a, [g.title]: e.target.value }))}
                    placeholder="Kunstner"
                    style={{
                      flex: 1, minWidth: '120px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      color: 'inherit',
                      fontSize: '0.82rem',
                    }}
                  />
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '0.75rem', flexShrink: 0, opacity: 0.7 }}
                    onClick={() => setArtistInput(a => ({ ...a, [g.title]: 'Various Artists' }))}
                    title="Sæt til Various Artists"
                  >
                    VA
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.8rem', flexShrink: 0 }}
                    onClick={() => merge(g)}
                    disabled={merging[g.title] || !artistInput[g.title]?.trim()}
                  >
                    {merging[g.title] ? 'Fletter…' : 'Flet'}
                  </button>
                  {mergeMsg[g.title] && (
                    <span style={{ fontSize: '0.78rem', color: mergeMsg[g.title]?.startsWith('✓') ? 'var(--neon-teal)' : 'var(--neon-amber)' }}>
                      {mergeMsg[g.title]}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Disk Analysis panel ──────────────────────────────────────

function DiskAnalysisPanel() {
  const qc = useQueryClient()
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-disk-analysis'],
    queryFn: adminApi.diskAnalysis,
    staleTime: 60_000,
    enabled: false, // only run when user clicks
  })
  const [purgeConfirm, setPurgeConfirm] = useState(false)
  const [purging, setPurging] = useState(false)
  const [purgeResult, setPurgeResult] = useState<string | null>(null)

  async function purgeOrphans() {
    setPurgeConfirm(false)
    setPurging(true)
    setPurgeResult(null)
    try {
      const res = await adminApi.purgeOrphans()
      setPurgeResult(`${res.purged} forældreløse poster slettet fra databasen.`)
      qc.invalidateQueries({ queryKey: ['system-metrics'] })
      refetch()
    } catch {
      setPurgeResult('Fejl ved sletning.')
    } finally {
      setPurging(false)
    }
  }

  const hasOrphans = (data?.orphaned_tracks ?? 0) > 0
  const hasUnindexed = (data?.unindexed_files ?? 0) > 0

  return (
    <div style={{ marginTop: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--chrome-bright)', margin: 0 }}>
          🔍 Diskanalyse
        </h3>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '0.8rem', padding: '5px 12px', gap: '6px' }}
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={13} className={isFetching ? 'spinning' : ''} />
          {data ? 'Opdater' : 'Analyser'}
        </button>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '12px' }}>
        Sammenligner filer på disken med databasen. Scanner <strong>aldrig</strong> og sletter <strong>aldrig</strong> noget automatisk.
      </p>

      {isLoading && <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Analyserer…</p>}

      {data && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {[
            { label: 'Filer på disk', value: data.files_on_disk, color: 'var(--neon-teal)' },
            { label: 'Numre i DB', value: data.tracks_in_db, color: 'var(--neon-primary)' },
            { label: 'Forældreløse (DB ≠ disk)', value: data.orphaned_tracks, color: data.orphaned_tracks > 0 ? 'var(--neon-amber, #ffaa00)' : 'var(--text-dim)' },
            { label: 'Ikke-indekserede (disk ≠ DB)', value: data.unindexed_files, color: data.unindexed_files > 0 ? '#7fd4ff' : 'var(--text-dim)' },
          ].map(s => (
            <div key={s.label} className="glass-card" style={{ padding: '12px 18px', minWidth: '160px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'monospace', color: s.color }}>{s.value.toLocaleString()}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: '4px' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {data && Object.keys(data.by_extension).length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {Object.entries(data.by_extension).sort(([, a], [, b]) => b - a).map(([ext, count]) => (
            <span key={ext} style={{ fontSize: '0.78rem', padding: '3px 10px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>
              {ext}: {count.toLocaleString()}
            </span>
          ))}
        </div>
      )}

      {data && hasUnindexed && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(127,212,255,0.06)', border: '1px solid rgba(127,212,255,0.2)' }}>
          <p style={{ fontSize: '0.82rem', color: '#7fd4ff', marginBottom: '8px', fontWeight: 600 }}>
            📂 {data.unindexed_files} filer på disk er ikke i databasen — kør "Scan musikmappe" for at indeksere dem.
          </p>
          {data.sample_unindexed.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '16px' }}>
              {data.sample_unindexed.slice(0, 8).map(p => (
                <li key={p} style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'monospace', marginBottom: '2px', wordBreak: 'break-all' }}>{p}</li>
              ))}
              {data.sample_unindexed.length > 8 && <li style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>… og {data.unindexed_files - 8} mere</li>}
            </ul>
          )}
        </div>
      )}

      {data && hasOrphans && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.25)' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--neon-amber, #ffaa00)', marginBottom: '8px', fontWeight: 600 }}>
            ⚠ {data.orphaned_tracks} DB-poster peger på filer der ikke eksisterer på disk.
          </p>
          {data.sample_orphans.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '16px', marginBottom: '8px' }}>
              {data.sample_orphans.slice(0, 8).map(p => (
                <li key={p} style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'monospace', marginBottom: '2px', wordBreak: 'break-all' }}>{p}</li>
              ))}
              {data.sample_orphans.length > 8 && <li style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>… og {data.orphaned_tracks - 8} mere</li>}
            </ul>
          )}
          {purgeResult && (
            <p style={{ fontSize: '0.82rem', color: 'var(--neon-teal)', marginBottom: '8px' }}>{purgeResult}</p>
          )}
          {!purgeConfirm ? (
            <button
              className="btn btn-ghost"
              style={{ fontSize: '0.78rem', color: 'var(--neon-red, #ff4444)', borderColor: 'rgba(255,68,68,0.3)', gap: '6px' }}
              onClick={() => setPurgeConfirm(true)}
              disabled={purging}
            >
              <Trash2 size={13} /> Ryd forældreløse poster…
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--neon-amber, #ffaa00)' }}>Sletter {data.orphaned_tracks} poster. Kan ikke fortrydes.</span>
              <button className="btn btn-ghost" style={{ fontSize: '0.78rem', color: 'var(--neon-red, #ff4444)' }} onClick={purgeOrphans} disabled={purging}>
                {purging ? 'Sletter…' : 'Ja, ryd'}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setPurgeConfirm(false)}>Annuller</button>
            </div>
          )}
        </div>
      )}

      {data && !hasOrphans && !hasUnindexed && (
        <p style={{ fontSize: '0.82rem', color: 'var(--neon-teal)' }}>✓ Disk og database er synkroniseret.</p>
      )}
    </div>
  )
}

// ─── Broken Files panel (embedded inside LibraryPanel) ───────

// ─── Incomplete metadata panel ────────────────────────────────

function IncompleteMetadataPanel() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [tracks, setTracks] = useState<IncompleteTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [filterIssue, setFilterIssue] = useState<string>('all')

  async function load() {
    setLoading(true)
    try {
      const data = await adminApi.incompleteMetadata()
      setTracks(data)
    } finally {
      setLoading(false)
    }
  }

  async function deleteOne(id: string) {
    setDeleting(id)
    try {
      await adminApi.deleteTrack(id)
      setTracks(t => t.filter(x => x.id !== id))
      qc.invalidateQueries({ queryKey: ['system-metrics'] })
    } finally {
      setDeleting(null) }
  }

  const issueLabel: Record<string, string> = {
    unknown_artist:   'Ukendt kunstner',
    unknown_album:    'Ukendt album',
    missing_duration: 'Mangler varighed',
  }

  const filtered = filterIssue === 'all'
    ? tracks
    : tracks.filter(t => t.issues.includes(filterIssue))

  return (
    <div style={{ marginTop: '28px', marginBottom: '28px' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => { setOpen(o => !o); if (!open && tracks.length === 0) load() }}
      >
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--neon-amber, #ffaa00)', margin: 0 }}>
          🔍 Manglende metadata
          {tracks.length > 0 && (
            <span style={{ marginLeft: '8px', fontWeight: 400, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
              — {tracks.length} numre
            </span>
          )}
        </h3>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{open ? '▲' : '▼'}</span>
        {open && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem', marginLeft: '4px' }}
            onClick={e => { e.stopPropagation(); load() }}
          >
            <RefreshCw size={13} className={loading ? 'spinning' : ''} /> Opdater
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: '12px' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '12px' }}>
            Disse numre er i databasen, men scanneren kunne ikke finde kunstner, album eller varighed —
            enten mangler tags i filen, eller mappestrukturen matchede ikke kendte mønstre.
            Du kan slette dem fra biblioteket (filen på disk berøres ikke) eller bruge
            <strong> Album Fixer</strong> / <strong>MusicBrainz Picard</strong> til at rette tags manuelt.
          </p>

          {loading && <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Indlæser…</p>}

          {!loading && tracks.length === 0 && (
            <p style={{ fontSize: '0.8rem', color: 'var(--neon-teal)' }}>
              ✓ Alle numre har kunstner, album og varighed
            </p>
          )}

          {!loading && tracks.length > 0 && (
            <>
              {/* Filter chips */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {(['all', 'unknown_artist', 'unknown_album', 'missing_duration'] as const).map(key => (
                  <button
                    key={key}
                    className="btn btn-ghost"
                    style={{
                      fontSize: '0.75rem',
                      padding: '3px 10px',
                      borderColor: filterIssue === key ? 'var(--neon-primary)' : undefined,
                      color: filterIssue === key ? 'var(--neon-primary)' : undefined,
                    }}
                    onClick={() => setFilterIssue(key)}
                  >
                    {key === 'all' ? `Alle (${tracks.length})` : `${issueLabel[key]} (${tracks.filter(t => t.issues.includes(key)).length})`}
                  </button>
                ))}
              </div>

              <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px' }}>
                {filtered.map(track => (
                  <div key={track.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {track.title}
                      </p>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '1px' }}>
                        <span style={{ color: track.artist === 'Unknown Artist' ? 'var(--neon-amber, #ffaa00)' : 'inherit' }}>
                          {track.artist}
                        </span>
                        {' — '}
                        <span style={{ color: track.album === 'Unknown Album' ? 'var(--neon-amber, #ffaa00)' : 'inherit' }}>
                          {track.album}
                        </span>
                        {track.duration_secs > 0 && (
                          <span style={{ marginLeft: '8px', color: 'rgba(255,255,255,0.3)' }}>
                            {Math.floor(track.duration_secs / 60)}:{String(track.duration_secs % 60).padStart(2, '0')}
                          </span>
                        )}
                      </p>
                      <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)', marginTop: '2px', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {track.file_path}
                      </p>
                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                        {track.issues.map(issue => (
                          <span key={issue} style={{
                            fontSize: '0.65rem', padding: '1px 6px', borderRadius: '10px',
                            background: 'rgba(255,170,0,0.15)', color: 'var(--neon-amber, #ffaa00)',
                            border: '1px solid rgba(255,170,0,0.3)',
                          }}>
                            {issueLabel[issue] ?? issue}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ flexShrink: 0, padding: '4px 8px', fontSize: '0.75rem', color: 'var(--neon-red, #ff4444)' }}
                      onClick={() => deleteOne(track.id)}
                      disabled={deleting === track.id}
                      title="Fjern fra bibliotek (filen berøres ikke)"
                    >
                      {deleting === track.id ? '…' : <Trash2 size={13} />}
                    </button>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.25)', marginTop: '6px' }}>
                Tip: Kør <strong>Scan musikmappe</strong> igen efter du har rettet tags med f.eks. MusicBrainz Picard — listen opdateres automatisk.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Broken files panel ────────────────────────────────────────
function BrokenFilesPanel() {
  const qc = useQueryClient()
  const { data: files = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-broken-files'],
    queryFn:  adminApi.brokenFiles,
  })
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [repairResult, setRepairResult] = useState<{ repaired: number; total: number } | null>(null)

  if (isLoading) return null
  if (files.length === 0) return (
    <div style={{ marginTop: '28px', marginBottom: '8px' }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--neon-teal)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        ✓ Ingen ødelagte filer fundet (alle numre har varighed)
      </p>
    </div>
  )

  async function deleteOne(id: string) {
    setDeleting(id)
    try {
      await adminApi.deleteTrack(id)
      qc.invalidateQueries({ queryKey: ['admin-broken-files'] })
      qc.invalidateQueries({ queryKey: ['system-metrics'] })
    } finally { setDeleting(null) }
  }

  async function deleteAll() {
    setConfirmAll(false)
    setDeletingAll(true)
    for (const f of files as Track[]) {
      try { await adminApi.deleteTrack(f.id) } catch { /* continue */ }
    }
    await qc.invalidateQueries({ queryKey: ['admin-broken-files'] })
    await qc.invalidateQueries({ queryKey: ['system-metrics'] })
    setDeletingAll(false)
  }

  async function repairAll() {
    setRepairing(true)
    setRepairResult(null)
    try {
      const result = await adminApi.repairBrokenFiles()
      setRepairResult(result)
      await qc.invalidateQueries({ queryKey: ['admin-broken-files'] })
    } finally {
      setRepairing(false)
    }
  }

  return (
    <div style={{ marginTop: '28px', marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--neon-amber, #ffaa00)', margin: 0 }}>
          ⚠ Fejlfiler — {(files as Track[]).length} numre uden varighed
        </h3>
        <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => refetch()}>
          <RefreshCw size={13} /> Opdater
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '0.8rem', color: 'var(--neon-teal)' }}
          onClick={repairAll}
          disabled={repairing || deletingAll}
        >
          <RefreshCw size={13} style={repairing ? { animation: 'spin 1s linear infinite' } : undefined} />
          {repairing ? 'Reparerer…' : 'Reparer varighed'}
        </button>
        {repairResult && (
          <span style={{ fontSize: '0.78rem', color: 'var(--neon-teal)' }}>
            ✓ {repairResult.repaired} / {repairResult.total} repareret
          </span>
        )}
        {!confirmAll ? (
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.8rem', color: 'var(--neon-red, #ff4444)', marginLeft: 'auto' }}
            onClick={() => setConfirmAll(true)}
            disabled={deletingAll}
          >
            <Trash2 size={13} /> Fjern alle fra bibliotek
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
            <button className="btn btn-ghost" style={{ fontSize: '0.8rem', color: 'var(--neon-red, #ff4444)' }} onClick={deleteAll} disabled={deletingAll}>
              {deletingAll ? 'Fjerner…' : 'Ja, fjern alle'}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setConfirmAll(false)}>Annuller</button>
          </div>
        )}
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '10px' }}>
        Disse numre mangler varighed — ofte fordi FLAC-filen har <code>totalSamples=0</code> i STREAMINFO-blokken (gyldigt format, men varighed ukendt).
        Klik <strong>Reparer varighed</strong> for at forsøge at læse varighed via ffprobe uden fuld scanning.
        Filerne på disken berøres ikke.
      </p>
      <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px' }}>
        {(files as Track[]).map(track => (
          <div key={track.id} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {track.title}
              </p>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {track.artist} — {track.album}
              </p>
              <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>
                {track.file_path}
              </p>
            </div>
            <button
              className="btn btn-ghost"
              style={{ flexShrink: 0, padding: '4px 8px', fontSize: '0.75rem', color: 'var(--neon-red, #ff4444)' }}
              onClick={() => deleteOne(track.id)}
              disabled={deleting === track.id}
            >
              {deleting === track.id ? '…' : <Trash2 size={13} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── SMTP panel ──────────────────────────────────────────────

function SmtpPanel() {
  const qc = useQueryClient()
  const { data: smtp, isLoading } = useQuery({
    queryKey: ['admin-smtp'],
    queryFn: adminApi.getSMTP,
  })

  const [form, setForm] = useState({
    enabled: false,
    host: '',
    port: 587,
    username: '',
    password: '',
    from: '',
    from_name: 'CrownJukebox',
  })
  const [testEmail, setTestEmail] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testError, setTestError] = useState('')

  // Populate form when data loads
  const initialized = useRef(false)
  if (smtp && !initialized.current) {
    initialized.current = true
    setForm(f => ({
      ...f,
      enabled: smtp.enabled,
      host: smtp.host,
      port: smtp.port,
      username: smtp.username,
      from: smtp.from,
      from_name: smtp.from_name,
    }))
  }

  const set = (key: string, value: string | number | boolean) =>
    setForm(f => ({ ...f, [key]: value }))

  async function handleSave() {
    setSaveStatus('saving')
    try {
      await adminApi.updateSMTP({ ...form })
      qc.invalidateQueries({ queryKey: ['admin-smtp'] })
      initialized.current = false
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 4000)
    }
  }

  async function handleTest() {
    if (!testEmail) return
    setTestStatus('sending')
    setTestError('')
    try {
      await adminApi.testSMTP(testEmail)
      setTestStatus('sent')
      setTimeout(() => setTestStatus('idle'), 5000)
    } catch (e: unknown) {
      setTestStatus('error')
      setTestError(e instanceof Error ? e.message : 'Ukendt fejl')
      setTimeout(() => setTestStatus('idle'), 6000)
    }
  }

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>Indlæser...</div>

  return (
    <div style={{ maxWidth: '620px' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '6px' }}>SMTP E-mail indstillinger</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '24px' }}>
        Konfigurer udgående mail til invitationer og notifikationer.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Enable toggle */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>Aktiver SMTP</p>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '3px' }}>
                Slå til for at sende e-mail invitationer.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={form.enabled}
              onClick={() => set('enabled', !form.enabled)}
              style={{
                flexShrink: 0,
                width: '48px', height: '26px', borderRadius: '13px', border: 'none',
                background: form.enabled ? 'var(--neon-primary)' : 'rgba(255,255,255,0.15)',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: '3px',
                left: form.enabled ? '25px' : '3px',
                width: '20px', height: '20px', borderRadius: '50%',
                background: 'white', transition: 'left 0.2s',
              }} />
            </button>
          </div>
        </div>

        {/* Server settings */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '16px' }}>
            Serverindstillinger
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '12px', alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '5px' }}>
                SMTP Host
              </label>
              <input
                className="input"
                placeholder="smtp.gmail.com"
                value={form.host}
                onChange={e => set('host', e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '5px' }}>
                Port
              </label>
              <input
                className="input"
                type="number"
                placeholder="587"
                value={form.port}
                onChange={e => set('port', parseInt(e.target.value) || 587)}
              />
            </div>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '8px' }}>
            Port 587 = STARTTLS (anbefalet) · Port 465 = SSL/TLS · Port 25 = uden kryptering
          </p>
        </div>

        {/* Auth */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '16px' }}>
            Godkendelse
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '5px' }}>
                Brugernavn
              </label>
              <input
                className="input"
                placeholder="din@email.dk"
                value={form.username}
                onChange={e => set('username', e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '5px' }}>
                Adgangskode {smtp?.password_set && <span style={{ color: 'var(--neon-green)', fontSize: '0.7rem' }}>✓ sat</span>}
              </label>
              <input
                className="input"
                type="password"
                placeholder={smtp?.password_set ? '••••••• (efterlad blank for at beholde)' : 'Adgangskode'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>

        {/* From */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '16px' }}>
            Afsender
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '5px' }}>
                Fra-adresse
              </label>
              <input
                className="input"
                placeholder="jukebox@dinserver.dk"
                value={form.from}
                onChange={e => set('from', e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '5px' }}>
                Afsendernavn
              </label>
              <input
                className="input"
                placeholder="CrownJukebox"
                value={form.from_name}
                onChange={e => set('from_name', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Save button */}
        <button
          className="btn btn-primary"
          style={{ alignSelf: 'flex-start' }}
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? 'Gemmer...' :
           saveStatus === 'saved'  ? '✓ Gemt!' :
           saveStatus === 'error'  ? '✗ Fejl ved gem' :
           'Gem SMTP indstillinger'}
        </button>

        {/* Test section */}
        <div className="glass-card" style={{ padding: '20px', borderColor: 'rgba(34,211,160,0.2)' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--neon-teal)', marginBottom: '12px' }}>
            Send test-mail
          </h3>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '14px' }}>
            Gem indstillingerne ovenfor, og send en testmail for at bekræfte opsætningen.
          </p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              className="input"
              placeholder="modtager@email.dk"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-ghost"
              style={{ flexShrink: 0, borderColor: 'var(--neon-teal)', color: 'var(--neon-teal)' }}
              onClick={handleTest}
              disabled={testStatus === 'sending' || !testEmail}
            >
              {testStatus === 'sending' ? 'Sender...' :
               testStatus === 'sent'    ? '✓ Sendt!' :
               testStatus === 'error'   ? '✗ Fejl' :
               'Send test'}
            </button>
          </div>
          {testStatus === 'error' && testError && (
            <p style={{ color: 'var(--neon-red)', fontSize: '0.8rem', marginTop: '10px' }}>{testError}</p>
          )}
          {testStatus === 'sent' && (
            <p style={{ color: 'var(--neon-green)', fontSize: '0.8rem', marginTop: '10px' }}>
              Test-mail sendt! Tjek din indbakke.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── YouTube panel ────────────────────────────────────────────────

function YouTubePanel() {
  const qc = useQueryClient()
  const { data: yt, isLoading } = useQuery({
    queryKey: ['admin-youtube'],
    queryFn: adminApi.getYouTube,
  })
  const [apiKey, setApiKey] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  async function handleSave() {
    setSaveStatus('saving')
    try {
      await adminApi.updateYouTube(apiKey)
      qc.invalidateQueries({ queryKey: ['admin-youtube'] })
      setApiKey('')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 4000)
    }
  }

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>Indlæser...</div>

  return (
    <div style={{ maxWidth: '620px' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '6px' }}>YouTube API-nøgle</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '24px' }}>
        Bruges til at søge YouTube-videoer, når brugere scanner QR-koden og tilføjer sange.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Status */}
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <span style={{ fontSize: '1.2rem' }}>▶</span>
            <p style={{ fontWeight: 600, fontSize: '0.95rem', margin: 0 }}>YouTube Data API v3</p>
            {yt?.api_key_set ? (
              <span style={{ marginLeft: 'auto', color: 'var(--neon-green)', fontSize: '0.8rem', fontWeight: 700 }}>
                ✓ Nøgle sat
              </span>
            ) : (
              <span style={{ marginLeft: 'auto', color: 'var(--neon-red)', fontSize: '0.8rem', fontWeight: 700 }}>
                ✗ Ikke konfigureret
              </span>
            )}
          </div>

          <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '5px' }}>
            API-nøgle {yt?.api_key_set && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(efterlad blank for at beholde eksisterende)</span>}
          </label>
          <input
            className="input"
            type="password"
            placeholder={yt?.api_key_set ? '••••••••••••••••••••• (sat)' : 'AIza...'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            autoComplete="off"
            style={{ fontFamily: 'monospace' }}
          />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '8px', lineHeight: 1.5 }}>
            Opret nøglen på{' '}
            <a
              href="https://console.cloud.google.com"
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: 'var(--neon-teal)', textDecoration: 'underline' }}
            >
              console.cloud.google.com
            </a>
            {' '}→ YouTube Data API v3 → Credentials → Create API key
          </p>
        </div>

        <button
          className="btn btn-primary"
          style={{ alignSelf: 'flex-start' }}
          onClick={handleSave}
          disabled={saveStatus === 'saving' || (!apiKey && yt?.api_key_set)}
        >
          {saveStatus === 'saving' ? 'Gemmer...' :
           saveStatus === 'saved'  ? '✓ Gemt!' :
           saveStatus === 'error'  ? '✗ Fejl ved gem' :
           'Gem API-nøgle'}
        </button>

        {/* How-to box */}
        <div className="glass-card" style={{ padding: '20px', borderColor: 'rgba(0,229,255,0.2)' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--neon-teal)', marginBottom: '12px' }}>
            Sådan opsætter du nøglen
          </h3>
          <ol style={{ color: 'var(--text-dim)', fontSize: '0.8rem', lineHeight: 1.8, paddingLeft: '18px', margin: 0 }}>
            <li>Gå til <strong style={{ color: 'var(--text-secondary)' }}>console.cloud.google.com</strong></li>
            <li>Opret et projekt (eller brug et eksisterende)</li>
            <li>Aktiver <strong style={{ color: 'var(--text-secondary)' }}>YouTube Data API v3</strong> under "APIs &amp; Services"</li>
            <li>Gå til Credentials → Create Credentials → API key</li>
            <li>Kopiér nøglen og indsæt den ovenfor</li>
          </ol>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '12px' }}>
            YouTube Data API v3 er gratis op til 10.000 søgninger om dagen, hvilket er mere end nok til privat brug.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Settings panel ───────────────────────────────────────────────

function SettingsPanel() {
  const qc = useQueryClient()
  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: adminApi.settings })
  const [local, setLocal] = useState<Record<string, string>>({})
  const merged = { ...settings, ...local }

  // Auto-detect jukebox URL from browser origin when not yet configured
  const detectedOrigin = window.location.origin
  const effectiveJukeboxUrl = (merged['jukebox_url'] ?? '').trim() || detectedOrigin

  // ── Keyboard bindings ──
  const { data: bindings = [] } = useQuery({ queryKey: ['keyboard-bindings'], queryFn: adminApi.keyboardBindings })
  const [bindingLocal, setBindingLocal] = useState<Record<string, string>>({})
  const [recording, setRecording] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      setBindingLocal(prev => ({ ...prev, [recording]: e.code }))
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [recording])

  async function save() {
    await adminApi.updateSettings(local)
    qc.invalidateQueries({ queryKey: ['settings'] })
    setLocal({})
  }

  const BINDING_DEFAULTS: Record<string, string> = {
    play_pause: 'Space', next_page: 'ArrowRight', prev_page: 'ArrowLeft',
    nav_up: 'ArrowUp', nav_down: 'ArrowDown', select: 'Enter',
    back: 'Escape', search: 'KeyS', party: 'KeyP',
    back_to_albums: 'Home',
  }

  async function saveBindings() {
    const updated = (bindings as KeyboardBinding[]).map(b => ({ ...b, key_code: bindingLocal[b.action] ?? b.key_code }))
    await adminApi.updateKeyboardBindings(updated)
    qc.invalidateQueries({ queryKey: ['keyboard-bindings'] })
    setBindingLocal({})
  }

  async function resetBindings() {
    const defaults = (bindings as KeyboardBinding[]).map(b => ({ ...b, key_code: BINDING_DEFAULTS[b.action] ?? b.key_code }))
    await adminApi.updateKeyboardBindings(defaults)
    qc.invalidateQueries({ queryKey: ['keyboard-bindings'] })
    setBindingLocal({})
  }

  function fmtKey(code: string | undefined | null): string {
    if (!code) return '—'
    const m: Record<string, string> = { Space: 'Mellemrum', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', Escape: 'Esc', Home: 'Home', PageUp: 'Page↑', PageDown: 'Page↓' }
    if (m[code]) return m[code]
    if (code.startsWith('Key')) return code.slice(3)
    if (code.startsWith('Digit')) return code.slice(5)
    return code
  }

  const settingKeys = [
    { key: 'party_volume_boost', label: 'SKÅLE volumen-boost (1-30%)' },
  ]

  return (
    <div style={{ maxWidth: '860px' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px' }}>Indstillinger</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

        {/* ── Jukebox URL ── */}
        <div className="glass-card" style={{ padding: '22px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '8px' }}>
            🌐 Jukebox URL
          </h3>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '14px' }}>
            Den offentlige URL som jukeboxen er tilgængelig på — bruges i invitationslinks og QR-koder.
            Normalt detekteres den automatisk fra din browser, men du kan overskrive den her.
          </p>
          {!(merged['jukebox_url'] ?? '').trim() && (
            <div style={{ background: 'rgba(34,211,160,0.08)', border: '1px solid rgba(34,211,160,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '0.82rem', color: '#22d3a0' }}>
              ✅ Auto-detekteret fra din browser: <strong>{detectedOrigin}</strong> — invitationer virker allerede uden at gemme.
            </div>
          )}
          <input
            className="input"
            type="url"
            placeholder={detectedOrigin}
            value={String(merged['jukebox_url'] ?? '')}
            onChange={e => setLocal(l => ({ ...l, jukebox_url: e.target.value }))}
          />
          <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '6px' }}>
            Lad feltet stå tomt for at bruge auto-detekteret URL (<code style={{ color: 'var(--neon-teal, #22d3a0)' }}>{detectedOrigin}</code>).
            Udfyld kun hvis du vil overskrive — fx hvis jukeboxen har en anden ekstern URL end din admin-browser.
          </p>
        </div>

        <div className="glass-card" style={{ padding: '22px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '16px' }}>Køindstillinger</h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Bekræft før tilføjelse</p>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '4px' }}>
                Når slået til, vises en bekræftelsesdialog inden et nummer tilføjes til køen.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={merged['queue_confirm_add'] === '1'}
              onClick={() => setLocal(l => ({ ...l, queue_confirm_add: merged['queue_confirm_add'] === '1' ? '0' : '1' }))}
              style={{
                flexShrink: 0,
                width: '48px', height: '26px', borderRadius: '13px', border: 'none',
                background: merged['queue_confirm_add'] === '1' ? 'var(--neon-primary)' : 'rgba(255,255,255,0.15)',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: '3px',
                left: merged['queue_confirm_add'] === '1' ? '25px' : '3px',
                width: '20px', height: '20px', borderRadius: '50%',
                background: 'white', transition: 'left 0.2s',
              }} />
            </button>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '22px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '16px' }}>Øvrige indstillinger</h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Autoplay aktiveret</p>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '4px' }}>Spil automatisk fra biblioteket, når brugerkøen er tom.</p>
            </div>
            <button
              role="switch"
              aria-checked={merged['autoplay_enabled'] === 'true' || merged['autoplay_enabled'] === '1'}
              onClick={() => setLocal(l => ({ ...l, autoplay_enabled: (merged['autoplay_enabled'] === 'true' || merged['autoplay_enabled'] === '1') ? 'false' : 'true' }))}
              style={{
                flexShrink: 0,
                width: '48px', height: '26px', borderRadius: '13px', border: 'none',
                background: (merged['autoplay_enabled'] === 'true' || merged['autoplay_enabled'] === '1') ? 'var(--neon-primary)' : 'rgba(255,255,255,0.15)',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: '3px',
                left: (merged['autoplay_enabled'] === 'true' || merged['autoplay_enabled'] === '1') ? '25px' : '3px',
                width: '20px', height: '20px', borderRadius: '50%',
                background: 'white', transition: 'left 0.2s',
              }} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {settingKeys.map(({ key, label }) => (
          <div key={key}>
            <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>{label}</label>
            <input
              className="input"
              value={String((merged as Record<string, string>)[key] ?? '')}
              onChange={e => setLocal(l => ({ ...l, [key]: e.target.value }))}
            />
          </div>
        ))}
          </div>
        </div>
        <div className="glass-card" style={{ padding: '22px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '8px' }}>Tastatur-genveje</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '16px' }}>Klik "Ændre" og tryk den ønskede tast. Tryk Escape for at annullere.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(bindings as KeyboardBinding[]).map(b => {
              const code = bindingLocal[b.action] ?? b.key_code
              const defaultCode = BINDING_DEFAULTS[b.action]
              const isChanged = b.key_code !== defaultCode
              const isRec = recording === b.action
              return (
                <div key={b.action} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{b.label || b.action}</span>
                    {defaultCode && <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginLeft: '8px' }}>standard: {fmtKey(defaultCode)}</span>}
                  </div>
                  <kbd style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: '4px',
                    fontSize: '0.85rem', fontFamily: 'monospace', minWidth: '90px', textAlign: 'center',
                    background: isRec ? 'var(--neon-primary)' : isChanged ? 'rgba(191,0,255,0.18)' : 'rgba(255,255,255,0.1)',
                    color: isRec ? '#000' : 'var(--text-primary)',
                    border: isChanged ? '1px solid rgba(191,0,255,0.5)' : '1px solid rgba(255,255,255,0.15)',
                  }}>
                    {isRec ? '⌨ ...' : fmtKey(code)}
                  </kbd>
                  <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '4px 10px', flexShrink: 0 }}
                    onClick={() => setRecording(isRec ? null : b.action)}>
                    {isRec ? 'Annuller' : 'Ændre'}
                  </button>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
            {Object.keys(bindingLocal).length > 0 && (
              <button className="btn btn-primary" onClick={saveBindings}>Gem genveje</button>
            )}
            <button className="btn btn-ghost" style={{ fontSize: '0.82rem' }} onClick={resetBindings}>Nulstil til standard</button>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '22px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '8px' }}>Direkte streaming</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '16px' }}>
            Valgfri alternativ base-URL til musikstreaming der bypasser Cloudflare og rammer serveren direkte.
            Nyttigt hvis du bruger Cloudflare som reverse proxy og vil undgå databegrænsninger.
            Al anden trafik (login, API, metadata) fortsætter via normal rute.
            Lad feltet stå tomt for at bruge normal rute.
          </p>
          <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>
            Direkte stream-URL
          </label>
          <input
            className="input"
            type="url"
            placeholder="http://192.168.1.x:3000  eller  https://stream.ditdomaene.dk"
            value={String(merged['direct_stream_url'] ?? '')}
            onChange={e => setLocal(l => ({ ...l, direct_stream_url: e.target.value }))}
          />
          <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '6px' }}>
            Skal pege direkte på denne server (uden Cloudflare imellem). Kan være WAN-IP:port eller et subdomain via din lokale proxy manager.
          </p>
        </div>

        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>
          Gem indstillinger
        </button>
      </div>
    </div>
  )
}

// ─── SKÅL Playlister panel ─────────────────────────────────────────

function SkaalPanel() {
  const qc = useQueryClient()
  const uploadRef = useRef<HTMLInputElement>(null)
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null)
  const [createName, setCreateName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const { data: playlists = [] } = useQuery({
    queryKey: ['skaal-playlists'],
    queryFn: adminApi.skaalPlaylists,
  })

  const { data: uploadedTracks = [] } = useQuery({
    queryKey: ['party-uploads'],
    queryFn: adminApi.listPartyUploads,
  })

  const { data: playlistTracks = [], refetch: refetchTracks } = useQuery({
    queryKey: ['playlist-tracks', selectedPlaylist?.ID],
    queryFn: () => selectedPlaylist ? adminApi.playlistTracks(selectedPlaylist.ID) : Promise.resolve([]),
    enabled: !!selectedPlaylist,
  })

  const { data: jukeboxes = [] } = useQuery({
    queryKey: ['admin-jukeboxes'],
    queryFn: adminApi.jukeboxes,
  })

  const createPlaylist = useMutation({
    mutationFn: (name: string) => adminApi.createPlaylist(name, false),
    onSuccess: (pl) => {
      qc.invalidateQueries({ queryKey: ['skaal-playlists'] })
      qc.invalidateQueries({ queryKey: ['admin-playlists'] })
      setSelectedPlaylist(pl)
      setShowCreate(false)
      setCreateName('')
    },
  })

  const deletePlaylist = useMutation({
    mutationFn: (id: string) => adminApi.deletePlaylist(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skaal-playlists'] })
      qc.invalidateQueries({ queryKey: ['admin-playlists'] })
      setSelectedPlaylist(null)
    },
  })

  const setDefault = useMutation({
    mutationFn: (id: string) => adminApi.updatePlaylist(id, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skaal-playlists'] })
      qc.invalidateQueries({ queryKey: ['admin-playlists'] })
    },
  })

  const addTrack = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: string; trackId: string }) =>
      adminApi.addPlaylistTrack(playlistId, trackId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['playlist-tracks', selectedPlaylist?.ID] }); refetchTracks() },
  })

  const removeTrack = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: string; trackId: string }) =>
      adminApi.removePlaylistTrack(playlistId, trackId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['playlist-tracks', selectedPlaylist?.ID] }); refetchTracks() },
  })

  const toggleIntro = useMutation({
    mutationFn: ({ playlistId, trackId, isIntro }: { playlistId: string; trackId: string; isIntro: boolean }) =>
      adminApi.setIntroTrack(playlistId, trackId, isIntro),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['playlist-tracks', selectedPlaylist?.ID] }); refetchTracks() },
  })

  const setUserPlaylist = useMutation({
    mutationFn: ({ roomId, playlistId }: { roomId: string; playlistId: string }) =>
      adminApi.setRoomPartyPlaylist(roomId, playlistId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-jukeboxes'] }),
  })

  const moveTrack = useCallback(async (trackId: string, direction: 'up' | 'down') => {
    if (!selectedPlaylist) return
    const current = [...playlistTracks]
    const idx = current.findIndex(t => t.id === trackId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= current.length) return
    const newOrder = current.map(t => t.id)
    ;[newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]]
    await adminApi.setPlaylistTrackOrder(selectedPlaylist.ID, newOrder)
    qc.invalidateQueries({ queryKey: ['playlist-tracks', selectedPlaylist.ID] })
    refetchTracks()
  }, [selectedPlaylist, playlistTracks, qc, refetchTracks])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploading(true)
    setUploadError('')
    try {
      await adminApi.uploadPartyFiles(files)
      qc.invalidateQueries({ queryKey: ['party-uploads'] })
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload fejlede')
    } finally {
      setUploading(false)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  const isInPlaylist = (trackId: string) => playlistTracks.some(t => t.id === trackId)

  const introTracks = playlistTracks.filter(t => t.is_intro).sort((a, b) => (a.track_number ?? 0) - (b.track_number ?? 0))
  const extraTracks = playlistTracks.filter(t => !t.is_intro)

  const formatDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const cardBase: React.CSSProperties = {
    background: 'var(--bg-panel)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px', height: '100%', minHeight: 0 }}>

      {/* ── Left: playlist list ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>SKÅL Playlister</h2>
          <button className="btn btn-primary" style={{ padding: '6px 10px', fontSize: '0.8rem' }}
            onClick={() => setShowCreate(v => !v)}>
            <Plus size={14} /> Ny
          </button>
        </div>

        {showCreate && (
          <form onSubmit={e => { e.preventDefault(); if (createName.trim()) createPlaylist.mutate(createName.trim()) }}
            style={{ display: 'flex', gap: '6px' }}>
            <input className="input" value={createName} onChange={e => setCreateName(e.target.value)}
              placeholder="Navn på playliste" autoFocus style={{ flex: 1, fontSize: '0.85rem' }} />
            <button className="btn btn-primary" type="submit" style={{ padding: '6px 10px' }}>OK</button>
          </form>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {playlists.map(pl => (
            <div key={pl.ID}
              onClick={() => setSelectedPlaylist(pl)}
              style={{
                padding: '10px 12px', borderRadius: '6px', cursor: 'pointer',
                background: selectedPlaylist?.ID === pl.ID ? 'rgba(191,0,255,0.15)' : 'rgba(255,255,255,0.04)',
                border: selectedPlaylist?.ID === pl.ID ? '1px solid rgba(191,0,255,0.4)' : '1px solid transparent',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}>
              {pl.IsPartyPlaylist && (
                <Star size={12} style={{ color: 'var(--neon-amber)', flexShrink: 0 }} fill="currentColor" />
              )}
              <span style={{ flex: 1, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pl.Name}
              </span>
              {!pl.IsPartyPlaylist && (
                <button className="btn btn-ghost btn-icon" style={{ padding: '3px', opacity: 0.5 }}
                  title="Sæt som standard"
                  onClick={e => { e.stopPropagation(); setDefault.mutate(pl.ID) }}>
                  <Star size={12} />
                </button>
              )}
              <button className="btn btn-ghost btn-icon" style={{ padding: '3px', color: 'var(--neon-accent)', opacity: 0.7 }}
                title="Slet"
                onClick={e => { e.stopPropagation(); if (confirm(`Slet "${pl.Name}"?`)) deletePlaylist.mutate(pl.ID) }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {playlists.length === 0 && (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', padding: '12px 0' }}>
              Ingen playlister endnu
            </p>
          )}
        </div>

        {/* Per-user assignment */}
        {selectedPlaylist && jukeboxes.length > 0 && (
          <div style={{ ...cardBase, padding: '14px', marginTop: '8px' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Tildel playliste til bruger
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {jukeboxes.map(jb => (
                <div key={jb.room_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {jb.display_name}
                  </span>
                  <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 8px', flexShrink: 0 }}
                    onClick={() => setUserPlaylist.mutate({ roomId: jb.room_id, playlistId: selectedPlaylist.ID })}>
                    Tildel
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Right: playlist detail ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
        {selectedPlaylist ? (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, flex: 1 }}>
                {selectedPlaylist.IsPartyPlaylist && <Star size={14} style={{ color: 'var(--neon-amber)', marginRight: '6px' }} fill="currentColor" />}
                {selectedPlaylist.Name}
              </h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{playlistTracks.length} numre</span>
              {selectedPlaylist.IsPartyPlaylist && (
                <span className="badge badge-primary" style={{ fontSize: '0.7rem' }}>Standard</span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1, minHeight: 0 }}>

              {/* ── Uploaded files pool ── */}
              <div style={{ ...cardBase, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Upload size={14} style={{ color: 'var(--neon-teal)' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>Uploadede filer</span>
                  <button className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                    onClick={() => uploadRef.current?.click()} disabled={uploading}>
                    {uploading ? 'Uploader...' : '+ Upload MP3'}
                  </button>
                  <input ref={uploadRef} type="file" accept="audio/*" multiple hidden onChange={handleUpload} />
                </div>
                {uploadError && (
                  <p style={{ padding: '8px 14px', color: 'var(--neon-accent)', fontSize: '0.8rem' }}>{uploadError}</p>
                )}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {uploadedTracks.map(t => (
                    <div key={t.id}
                      onDoubleClick={() => selectedPlaylist && !isInPlaylist(t.id) && addTrack.mutate({ playlistId: selectedPlaylist.ID, trackId: t.id })}
                      style={{
                        padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '10px',
                        cursor: 'pointer', transition: 'background 0.15s',
                        opacity: isInPlaylist(t.id) ? 0.4 : 1,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.artist}</div>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', flexShrink: 0 }}>{formatDur(t.duration_secs)}</span>
                      {!isInPlaylist(t.id) && (
                        <button className="btn btn-ghost btn-icon" style={{ padding: '3px', color: 'var(--neon-primary)' }}
                          title="Tilføj til playliste"
                          onClick={() => addTrack.mutate({ playlistId: selectedPlaylist.ID, trackId: t.id })}>
                          <Plus size={14} />
                        </button>
                      )}
                      <button className="btn btn-ghost btn-icon" style={{ padding: '3px', color: 'var(--neon-accent)', opacity: 0.7 }}
                        title="Slet fil permanent"
                        onClick={async () => {
                          if (!confirm(`Slet "${t.title}" permanent?`)) return
                          await adminApi.deletePartyUpload(t.id)
                          qc.invalidateQueries({ queryKey: ['party-uploads'] })
                          qc.invalidateQueries({ queryKey: ['playlist-tracks', selectedPlaylist?.ID] })
                        }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {uploadedTracks.length === 0 && (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                      Upload MP3-filer for at komme i gang
                    </div>
                  )}
                </div>
              </div>

              {/* ── Playlist contents ── */}
              <div style={{ ...cardBase, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Playliste indhold</span>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                    Intro-numre spilles i rækkefølge — resten vælges tilfældigt
                  </p>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {/* Intro tracks */}
                  {introTracks.length > 0 && (
                    <div>
                      <div style={{ padding: '6px 14px', fontSize: '0.7rem', color: 'var(--neon-amber)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'rgba(255,165,0,0.06)' }}>
                        Intro ({introTracks.length})
                      </div>
                      {introTracks.map((t, i) => (
                        <PlaylistTrackRow key={t.id} track={t} isIntro index={i + 1}
                          onToggleIntro={() => toggleIntro.mutate({ playlistId: selectedPlaylist.ID, trackId: t.id, isIntro: false })}
                          onRemove={() => removeTrack.mutate({ playlistId: selectedPlaylist.ID, trackId: t.id })}
                          onMoveUp={() => moveTrack(t.id, 'up')}
                          onMoveDown={() => moveTrack(t.id, 'down')}
                          showMoveUp={i > 0}
                          showMoveDown={i < introTracks.length - 1}
                          formatDur={formatDur} />
                      ))}
                    </div>
                  )}

                  {/* Non-intro tracks */}
                  {extraTracks.length > 0 && (
                    <div>
                      <div style={{ padding: '6px 14px', fontSize: '0.7rem', color: 'var(--neon-teal)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', background: 'rgba(0,255,204,0.04)' }}>
                        Ekstra / Tilfældig ({extraTracks.length})
                      </div>
                      {extraTracks.map(t => (
                        <PlaylistTrackRow key={t.id} track={t} isIntro={false} index={null}
                          onToggleIntro={() => toggleIntro.mutate({ playlistId: selectedPlaylist.ID, trackId: t.id, isIntro: true })}
                          onRemove={() => removeTrack.mutate({ playlistId: selectedPlaylist.ID, trackId: t.id })}
                          onMoveUp={() => {}} onMoveDown={() => {}}
                          showMoveUp={false} showMoveDown={false}
                          formatDur={formatDur} />
                      ))}
                    </div>
                  )}

                  {playlistTracks.length === 0 && (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                      Dobbeltklik på et nummer til venstre for at tilføje det
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '16px', color: 'var(--text-dim)' }}>
            <PartyPopper size={48} style={{ opacity: 0.3 }} />
            <p>Vælg en playliste til venstre for at redigere den</p>
          </div>
        )}
      </div>
    </div>
  )
}

interface PlaylistTrackRowProps {
  track: Track
  isIntro: boolean
  index: number | null
  onToggleIntro: () => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  showMoveUp: boolean
  showMoveDown: boolean
  formatDur: (s: number) => string
}

function PlaylistTrackRow({ track, isIntro, index, onToggleIntro, onRemove, onMoveUp, onMoveDown, showMoveUp, showMoveDown, formatDur }: PlaylistTrackRowProps) {
  return (
    <div style={{
      padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px',
      transition: 'background 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
      {isIntro && index !== null && (
        <span style={{ fontSize: '0.7rem', color: 'var(--neon-amber)', fontWeight: 700, minWidth: '18px', textAlign: 'center' }}>
          {index}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist}</div>
      </div>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', flexShrink: 0 }}>{formatDur(track.duration_secs)}</span>

      {isIntro && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {showMoveUp && (
            <button className="btn btn-ghost btn-icon" style={{ padding: '1px' }} onClick={onMoveUp} title="Flyt op">
              <ChevronUp size={12} />
            </button>
          )}
          {showMoveDown && (
            <button className="btn btn-ghost btn-icon" style={{ padding: '1px' }} onClick={onMoveDown} title="Flyt ned">
              <ChevronDown size={12} />
            </button>
          )}
        </div>
      )}

      <button className="btn btn-ghost btn-icon" style={{ padding: '3px', color: isIntro ? 'var(--neon-amber)' : 'var(--text-dim)' }}
        title={isIntro ? 'Fjern intro-markering' : 'Sæt som intro'}
        onClick={onToggleIntro}>
        <Star size={12} fill={isIntro ? 'currentColor' : 'none'} />
      </button>

      <button className="btn btn-ghost btn-icon" style={{ padding: '3px', color: 'var(--neon-accent)' }}
        title="Fjern fra playliste"
        onClick={onRemove}>
        <Trash2 size={12} />
      </button>
    </div>
  )
}
