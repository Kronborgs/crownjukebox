import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, User } from '@/api/client'
import { ChevronLeft, Plus, UserCheck, UserX, Trash2, RefreshCw, Settings, Music2, X, KeyRound } from 'lucide-react'

type AdminTab = 'users' | 'settings' | 'library'

export function AdminLayout() {
  const [tab, setTab] = useState<AdminTab>('users')

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(191,0,255,0.2)', display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--bg-panel)' }}>
        <Link to="/" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}>
          <ChevronLeft size={18} /> Tilbage
        </Link>
        <span className="neon-text-primary" style={{ fontSize: '1.4rem' }}>♛</span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--chrome-bright)' }}>
          Admin Panel
        </h1>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'var(--bg-panel)', flexShrink: 0 }}>
        {([
          { id: 'users',    icon: <UserCheck size={16} />, label: 'Brugere' },
          { id: 'library',  icon: <Music2 size={16} />,    label: 'Bibliotek' },
          { id: 'settings', icon: <Settings size={16} />,  label: 'Indstillinger' },
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
        {tab === 'users'    && <UsersPanel />}
        {tab === 'library'  && <LibraryPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </div>
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
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [isPermanent, setIsPermanent] = useState(false)
  const [durationMinutes, setDurationMinutes] = useState(480)
  const [canQueue, setCanQueue] = useState(true)
  const [canSearch, setCanSearch] = useState(true)
  const [canParty, setCanParty] = useState(true)
  const [canViewQueue, setCanViewQueue] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) { setError('Navn er påkrævet'); return }
    setSaving(true)
    setError('')
    try {
      await adminApi.createUser({
        display_name: displayName.trim(),
        username: username.trim() || undefined,
        pin: pin || undefined,
        role,
        is_permanent: isPermanent,
        access_duration_minutes: isPermanent ? undefined : durationMinutes,
        can_add_to_queue: canQueue,
        can_search: canSearch,
        can_use_party_button: canParty,
        can_view_queue: canViewQueue,
      })
      onCreated()
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
            <label style={labelStyle}>Brugernavn (valgfrit)</label>
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="gaest1" />
          </div>
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
              <label style={labelStyle}>Adgangsvarighed (minutter)</label>
              <input className="input" type="number" min={1} value={durationMinutes} onChange={e => setDurationMinutes(Number(e.target.value))} />
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
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuller</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Opretter…' : 'Opret bruger'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Library panel ────────────────────────────────────────────────

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

  async function uploadPartyFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingPartyFiles(true)
    setScanStatus('Uploader SKÅLE-filer…')
    try {
      const result = await adminApi.uploadPartyPlaylistTracks(Array.from(files))
      qc.invalidateQueries({ queryKey: ['admin-playlists'] })
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
          <Plus size={16} /> {uploadingPartyFiles ? 'Uploader SKÅLE-filer…' : 'Upload filer til global SKÅLE-liste'}
        </button>
        {scanStatus && (
          <p style={{ color: 'var(--neon-teal)', fontSize: '0.85rem', marginTop: '8px' }}>{scanStatus}</p>
        )}
      </div>

      {/* Playlist management */}
      <div style={{ marginTop: '32px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', color: 'var(--chrome-bright)' }}>
          SKÅLE-playliste
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '16px' }}>
          Marker hvilken playliste der bruges til SKÅLE-funktionen. Kun én kan være aktiv ad gangen.
        </p>
        <p style={{ fontSize: '0.8rem', color: 'var(--neon-amber)', marginBottom: '16px' }}>
          Upload-knappen ovenfor lægger filer i den samme globale SKÅLE-playliste for alle brugere og skærme.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px' }}>
          {(playlists as import('@/api/client').Playlist[]).map(pl => (
            <div key={pl.id} className="glass-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{pl.name}</p>
              </div>
              <button
                className={pl.is_party_playlist ? 'btn btn-primary' : 'btn btn-ghost'}
                style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                onClick={() => setPartyPlaylist(pl.id, !pl.is_party_playlist)}
              >
                {pl.is_party_playlist ? '★ Aktiv SKÅLE' : 'Brug til SKÅLE'}
              </button>
            </div>
          ))}
        </div>

        {/* Opret ny playliste */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', maxWidth: '480px' }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Ny playliste navn…"
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

// ─── Settings panel ───────────────────────────────────────────────

function SettingsPanel() {
  const qc = useQueryClient()
  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: adminApi.settings })
  const [local, setLocal] = useState<Record<string, string>>({})
  const merged = { ...settings, ...local }

  async function save() {
    await adminApi.updateSettings(local)
    qc.invalidateQueries({ queryKey: ['settings'] })
    setLocal({})
  }

  const settingKeys = [
    { key: 'party_playlist_id', label: 'Party playlist ID' },
    { key: 'autoplay_enabled',  label: 'Autoplay aktiveret (true/false)' },
  ]

  return (
    <div style={{ maxWidth: '860px' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px' }}>Indstillinger</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {settingKeys.map(({ key, label }) => (
          <div key={key}>
            <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>{label}</label>
            <input
              className="input"
              value={(merged as Record<string, string>)[key] ?? ''}
              onChange={e => setLocal(l => ({ ...l, [key]: e.target.value }))}
            />
          </div>
        ))}
          </div>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>
          Gem indstillinger
        </button>
      </div>
    </div>
  )
}
