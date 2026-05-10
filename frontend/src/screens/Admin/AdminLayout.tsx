import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, User, Track, Playlist, KeyboardBinding, setCurrentRoomId } from '@/api/client'
import { useSession } from '@/hooks/useSession'
import { Plus, UserCheck, UserX, Trash2, RefreshCw, Settings, Music2, X, KeyRound, Radio, LayoutDashboard, Mail, PartyPopper, Upload, Star, ChevronUp, ChevronDown, LogOut } from 'lucide-react'

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
        {tab === 'library'   && <LibraryPanel />}
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
    refetchInterval: 3000,
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

function JukeboxesPanel() {
  const navigate = useNavigate()
  const { data: jukeboxes = [], refetch } = useQuery({
    queryKey: ['admin-jukeboxes'],
    queryFn: adminApi.jukeboxes,
    refetchInterval: 3000, // Auto-refresh every 3 seconds
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
        Oversigt over alle brugeres jukeboxes. Hver bruger har sin egen afspilningskø og tilstand.
      </p>

      <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {jukeboxes.map((jb) => (
          <div
            key={jb.user_id}
            className="glass-card"
            style={{
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              position: 'relative',
            }}
          >
            {/* Status indicator */}
            <div
              style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: jb.is_playing ? 'var(--neon-green)' : 'var(--text-dim)',
                boxShadow: jb.is_playing ? '0 0 12px var(--neon-green)' : 'none',
                animation: jb.is_playing ? 'pulse 2s infinite' : 'none',
              }}
            />

            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--chrome-bright)', marginBottom: '4px' }}>
                {jb.display_name}
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                ID: {jb.user_id.slice(0, 8)}...
              </p>
            </div>

            {jb.current_track && (
              <div style={{ padding: '10px 12px', background: 'rgba(191, 0, 255, 0.08)', borderRadius: '6px', borderLeft: '3px solid var(--neon-primary)' }}>
                <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                  {jb.current_track.title}
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--neon-teal)' }}>
                  {jb.current_track.artist}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
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
              {jb.is_party_mode && (
                <span style={{ color: 'var(--neon-amber)', fontWeight: 700 }}>🍻 SKÅL</span>
              )}
            </div>

            <button
              className="btn btn-primary"
              style={{ marginTop: '8px', fontSize: '0.85rem' }}
              onClick={() => viewJukebox(jb.room_id)}
            >
              Vis Jukebox →
            </button>
          </div>
        ))}
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

function LibraryPanel() {
  const qc = useQueryClient()
  const [scanStatus, setScanStatus] = useState('')
  const { data: playlists = [] } = useQuery({ queryKey: ['admin-playlists'], queryFn: adminApi.playlists })
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [uploadingPartyFiles, setUploadingPartyFiles] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function rescan() {
    setScanStatus('Scanner…')
    try {
      await adminApi.rescan()
      setScanStatus('Scanning startet — se SSE for fremgang')
    } catch { setScanStatus('Fejl ved scanning') }
  }

  async function rescanArtwork() {
    setScanStatus('Henter album covers…')
    try {
      await adminApi.rescanArtwork()
      setScanStatus('Cover-scanning startet')
    } catch { setScanStatus('Fejl') }
  }

  async function createPlaylist() {
    if (!newPlaylistName.trim()) return
    await adminApi.createPlaylist(newPlaylistName.trim())
    qc.invalidateQueries({ queryKey: ['admin-playlists'] })
    setNewPlaylistName('')
  }

  async function setPartyPlaylist(id: string, isParty: boolean) {
    await adminApi.updatePlaylist(id, isParty)
    qc.invalidateQueries({ queryKey: ['admin-playlists'] })
  }

  async function deletePlaylist(id: string, name: string) {
    try {
      if (!confirm(`Slet playlisten "${name}"? Dette kan ikke fortrydes.`)) return
      
      console.log('[deletePlaylist] Sletter playlist:', id, name)
      await adminApi.deletePlaylist(id)
      console.log('[deletePlaylist] Playlist slettet, opdaterer liste')
      await qc.invalidateQueries({ queryKey: ['admin-playlists'] })
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
        <button className="btn btn-primary" style={{ justifyContent: 'flex-start', gap: '10px' }} onClick={rescan}>
          <RefreshCw size={16} /> Scan musikmappe
        </button>
        <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', gap: '10px' }} onClick={rescanArtwork}>
          <RefreshCw size={16} /> Genindlæs album covers
        </button>
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
        {scanStatus && (
          <p style={{ color: 'var(--neon-teal)', fontSize: '0.85rem', marginTop: '8px' }}>{scanStatus}</p>
        )}
      </div>

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
    queryFn: adminApi.playlists,
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
      setSelectedPlaylist(pl)
      setShowCreate(false)
      setCreateName('')
    },
  })

  const deletePlaylist = useMutation({
    mutationFn: (id: string) => adminApi.deletePlaylist(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skaal-playlists'] })
      setSelectedPlaylist(null)
    },
  })

  const setDefault = useMutation({
    mutationFn: (id: string) => adminApi.updatePlaylist(id, true),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skaal-playlists'] }),
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
