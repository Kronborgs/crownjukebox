// API base URL — in development proxied by Vite; in production served same-origin
const BASE = import.meta.env.VITE_API_BASE ?? ''

// ─── Types ────────────────────────────────────────────────────────

export interface User {
  id: string
  display_name: string
  username: string
  role: 'admin' | 'user'
  is_active: boolean
  is_permanent: boolean
  access_expires_at: string | null
  created_at: string
  last_seen_at: string | null
}

export interface Permissions {
  can_add_to_queue: boolean
  can_search: boolean
  can_use_party_button: boolean
  can_view_queue: boolean
}

export interface Artist {
  id: string
  name: string
  sort_name: string
  album_count: number
}

export interface Album {
  id: string
  title: string
  artist_id: string
  year: number | null
  genre: string
  cover_art_id: string
  track_count: number
  // Joined fields
  artist_name?: string
  cover_url?: string
}

export interface Track {
  id: string
  album_id: string
  artist_id: string
  title: string
  artist: string
  album: string
  track_number: number
  disc_number: number
  duration_secs: number
  genre: string
  file_path: string
  file_size: number
  cover_art_id: string
}

export interface QueueItem {
  id: string
  track_id: string
  track_title: string
  track_artist: string
  track_album: string
  duration_secs: number
  added_by_user_id: string
  position: number
  is_autoplay: boolean
  album_cover_art_id: string
}

export interface PlaybackState {
  is_playing: boolean
  is_party_mode: boolean
  current_track: Track | null
  position_secs: number
  queue_length: number
  updated_at: string
}

export interface SearchResults {
  artists: Artist[]
  albums: Album[]
  tracks: Track[]
}

export interface Setting {
  [key: string]: string
}

export interface AccessLink {
  id: string
  user_id: string
  created_at: string
  expires_at: string | null
  used_at: string | null
  revoked_at: string | null
  login_url?: string
}

export interface Session {
  id: string
  user_id: string
  device_name: string
  ip_address: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_seen_at: string | null
}

export interface PlaybackHistory {
  id: string
  track_id: string
  played_by_user_id: string
  started_at: string
  ended_at: string | null
  was_skipped: boolean
}

export interface Playlist {
  ID: string
  Name: string
  SourceType: string
  SourceID: string
  IsPartyPlaylist: boolean
  IntroTrackID: string | null
  CreatedAt: string
}

export interface PartyPlaylistUploadResult {
  status: string
  playlist_id: string
  uploaded: Array<{
    track_id: string
    title: string
    path: string
  }>
}

export interface KeyboardBinding {
  action: string
  key_code: string
  label: string
}

// ─── HTTP client ──────────────────────────────────────────────────

export interface Room {
  id: string
  name: string
  owner_user_id?: string
  party_playlist_id?: string
  created_at: string
  updated_at: string
}

export interface JukeboxStatus {
  user_id: string
  display_name: string
  room_id: string
  is_playing: boolean
  is_party_mode: boolean
  current_track?: {
    id: string
    title: string
    artist: string
  }
  queue_length: number
}

export interface SystemMetrics {
  memory: {
    alloc_mb: string
    sys_mb: string
    gc_cycles: number
  }
  runtime: {
    goroutines: number
    go_version: string
    num_cpu: number
  }
  database: {
    tracks: number
    albums: number
    artists: number
    users: number
    rooms: number
  }
  uptime_seconds: number
}

export interface SmtpConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  password_set: boolean
  from: string
  from_name: string
}

export interface SmtpSavePayload {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
  from: string
  from_name: string
}

// ─── Room ID helper ───────────────────────────────────────────────

export function getCurrentRoomId(): string {
  return sessionStorage.getItem('cj_room_id') ?? 'default'
}

export function setCurrentRoomId(id: string): void {
  sessionStorage.setItem('cj_room_id', id)
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('cj_token')
  const roomId = getCurrentRoomId()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['X-Session-Token'] = token
  }
  if (roomId && roomId !== 'default') {
    headers['X-Room-ID'] = roomId
  }

  const res = await fetch(BASE + path, { ...options, headers })

  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.error ?? msg
    } catch {}
    throw new ApiError(res.status, msg)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json()
}

async function requestForm<T>(path: string, formData: FormData): Promise<T> {
  const token = sessionStorage.getItem('cj_token')
  const roomId = getCurrentRoomId()
  const headers: Record<string, string> = {}
  if (token) {
    headers['X-Session-Token'] = token
  }
  if (roomId && roomId !== 'default') {
    headers['X-Room-ID'] = roomId
  }

  const res = await fetch(BASE + path, { method: 'POST', headers, body: formData })

  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.error ?? msg
    } catch {}
    throw new ApiError(res.status, msg)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

const get  = <T>(path: string) => request<T>(path, { method: 'GET' })
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })
const put  = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const del  = <T>(path: string) => request<T>(path, { method: 'DELETE' })

const getList = async <T>(path: string): Promise<T[]> => {
  const res = await get<T[] | null>(path)
  return Array.isArray(res) ? res : []
}

// ─── Auth ─────────────────────────────────────────────────────────

export const authApi = {
  login:   (username: string, pin: string) =>
    post<{ token: string; user: User }>('/api/auth/login', { username, pin }),
  qrLogin: (token: string) =>
    post<{ token: string; user: User }>('/api/auth/qr-login', { token }),
  logout:  () => post('/api/auth/logout'),
  me:      () => get<{ user: User; permissions: Permissions }>('/api/auth/me'),
}

// ─── Library ──────────────────────────────────────────────────────

// Normalize album objects from either lowercase (current backend) or PascalCase
// (older backend builds that lacked json struct tags) field names.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeAlbum(raw: any): Album {
  return {
    id:           raw.id           ?? raw.ID           ?? '',
    title:        raw.title        ?? raw.Title        ?? '',
    artist_id:    raw.artist_id    ?? raw.ArtistID     ?? '',
    year:         raw.year         ?? raw.Year         ?? null,
    genre:        raw.genre        ?? raw.Genre        ?? '',
    cover_art_id: raw.cover_art_id ?? raw.CoverArtID  ?? '',
    track_count:  raw.track_count  ?? raw.TrackCount   ?? 0,
    artist_name:  raw.artist_name  ?? raw.ArtistName,
    cover_url:    raw.cover_url    ?? raw.CoverURL,
  }
}

export const libraryApi = {
  artists: () => getList<Artist>('/api/library/artists'),
  albums:  async (artistId?: string, page = 1, limit = 40): Promise<Album[]> => {
    const data = await getList<unknown>(`/api/library/albums?${artistId ? `artist_id=${artistId}&` : ''}page=${page}&limit=${limit}`)
    return data.map(normalizeAlbum)
  },
  album:      (id: string) => get<Album>(`/api/library/albums/${id}`),
  albumTracks: (id: string) => getList<Track>(`/api/library/albums/${id}/tracks`),
  track:      (id: string) => get<Track>(`/api/library/tracks/${id}`),
  search:     (q: string) => get<SearchResults>(`/api/library/search?q=${encodeURIComponent(q)}`),
  missingCovers: () => getList<Album>('/api/library/missing-covers'),
  coverUrl:   (id: string, size: 'small' | 'medium' | 'large' = 'medium') =>
    `${BASE}/api/library/cover/${id}?size=${size}`,
  streamUrl:  (trackId: string) => `${BASE}/api/playback/stream/${trackId}`,
}

// ─── Queue ────────────────────────────────────────────────────────

export const queueApi = {
  get:     () => getList<QueueItem>('/api/queue'),
  add:     (trackId: string) => post<QueueItem>('/api/queue', { track_id: trackId }),
  remove:  (id: string) => del(`/api/queue/${id}`),
  reorder: (order: string[]) => post('/api/queue/reorder', { order }),
}

// ─── Playback ─────────────────────────────────────────────────────

export const playbackApi = {
  state:          () => get<PlaybackState>('/api/playback/state'),
  play:           (trackId?: string) => post('/api/playback/play', trackId ? { track_id: trackId } : {}),
  pause:          () => post('/api/playback/pause'),
  skip:           () => post('/api/playback/skip'),
  trackEnded:     (trackId: string) => post<void>('/api/playback/track-ended', { track_id: trackId }),
  updatePosition: (position: number) => post('/api/playback/position', { position }),
  history:        () => getList<PlaybackHistory>('/api/playback/history'),
}

// ─── Party ────────────────────────────────────────────────────────

export const partyApi = {
  cheers: () => post<{ track: Track; status: string }>('/api/party/cheers'),
  state:  () => get<{ is_party_mode: boolean }>('/api/party/state'),
}

// ─── Admin ────────────────────────────────────────────────────────

export const adminApi = {
  // Users
  users:      () => getList<User>('/api/admin/users'),
  createUser: (data: Partial<User> & { pin?: string; can_add_to_queue?: boolean; can_search?: boolean; can_use_party_button?: boolean; can_view_queue?: boolean; access_duration_minutes?: number }) =>
    post<User>('/api/admin/users', data),
  getUser:    (id: string) => get<User>(`/api/admin/users/${id}`),
  updateUser: (id: string, data: Partial<User>) => patch<void>(`/api/admin/users/${id}`, data),
  disableUser: (id: string) => post<void>(`/api/admin/users/${id}/disable`),
  enableUser:  (id: string) => post<void>(`/api/admin/users/${id}/enable`),
  extendUser:  (id: string, minutes: number) =>
    post<{ new_expires_at: string }>(`/api/admin/users/${id}/extend`, { duration_minutes: minutes }),
  deleteUser:  (id: string) => del(`/api/admin/users/${id}`),

  // Access links
  createAccessLink: (userId: string, expiresInMinutes = 0) =>
    post<AccessLink>('/api/admin/access-links', { user_id: userId, expires_in_minutes: expiresInMinutes }),
  listAccessLinks: () => getList<AccessLink>('/api/admin/access-links'),
  revokeAccessLink: (id: string) => post<void>(`/api/admin/access-links/${id}/revoke`),

  // Sessions
  sessions:      () => getList<Session>('/api/admin/sessions'),
  revokeSession: (id: string) => post<void>(`/api/admin/sessions/${id}/revoke`),

  // Settings
  settings:       () => get<Setting>('/api/settings'),
  updateSettings: (data: Setting) => put<void>('/api/settings', data),

  // Scanning
  rescan:               () => post('/api/admin/rescan'),
  rescanArtwork:        () => post('/api/admin/rescan-artwork'),
  rescanMissingArtwork: () => post('/api/admin/rescan-missing-artwork'),
  missingArtwork:       () => getList<Album>('/api/admin/missing-artwork'),

  // Keyboard bindings
  keyboardBindings:       () => getList<KeyboardBinding>('/api/admin/keyboard-bindings'),
  updateKeyboardBindings: (bindings: KeyboardBinding[]) => put<void>('/api/admin/keyboard-bindings', bindings),

  // Playlists
  playlists:          () => getList<Playlist>('/api/admin/playlists'),
  createPlaylist:     (name: string, isParty = false) =>
    post<Playlist>('/api/admin/playlists', { name, is_party_playlist: isParty }),
  updatePlaylist:     (id: string, isPartyPlaylist: boolean) =>
    patch<void>(`/api/admin/playlists/${id}`, { is_party_playlist: isPartyPlaylist }),
  deletePlaylist:     (id: string) => del(`/api/admin/playlists/${id}`),
  playlistTracks:     (playlistId: string) => getList<Track>(`/api/admin/playlists/${playlistId}/tracks`),
  setIntroTrack:      (playlistId: string, trackId: string | null) =>
    put<void>(`/api/admin/playlists/${playlistId}/intro-track`, { track_id: trackId ?? '' }),
  addPlaylistTrack:    (playlistId: string, trackId: string) =>
    post<void>(`/api/admin/playlists/${playlistId}/tracks`, { track_id: trackId }),
  removePlaylistTrack: (playlistId: string, trackId: string) =>
    del(`/api/admin/playlists/${playlistId}/tracks/${trackId}`),
  uploadPartyPlaylistTracks: (files: File[]) => {
    const form = new FormData()
    files.forEach(file => form.append('files', file))
    return requestForm<PartyPlaylistUploadResult>('/api/admin/party-playlist/upload', form)
  },

  // Password management
  changePassword: (userId: string, newPassword: string) =>
    put<void>(`/api/admin/users/${userId}/password`, { new_password: newPassword }),

  // Invite user
  inviteUser: (userId: string, email: string, expiresInMinutes = 0) =>
    post<{ status: string }>(`/api/admin/users/${userId}/invite`, { email, expires_in_minutes: expiresInMinutes }),

  // Room management (admin)
  createRoom: (name: string) => post<Room>('/api/admin/rooms', { name }),
  deleteRoom: (id: string) => del(`/api/admin/rooms/${id}`),
  setRoomPartyPlaylist: (roomId: string, playlistId: string) =>
    put<void>(`/api/admin/rooms/${roomId}/party-playlist`, { playlist_id: playlistId }),

  // Jukebox monitoring (admin)
  jukeboxes: () => getList<JukeboxStatus>('/api/admin/jukeboxes'),

  // System metrics
  systemMetrics: () => get<SystemMetrics>('/api/admin/system-metrics'),

  // SMTP
  getSMTP: () => get<SmtpConfig>('/api/admin/smtp'),
  updateSMTP: (data: SmtpSavePayload) => put<void>('/api/admin/smtp', data),
  testSMTP: (to: string) => post<{ status: string }>('/api/admin/smtp/test', { to }),
}

// ─── Rooms ────────────────────────────────────────────────────────

export const roomApi = {
  list: () => getList<Room>('/api/rooms'),
}

// ─── Setup ────────────────────────────────────────────────────────

export const setupApi = {
  status: () => get<{ needs_setup: boolean }>('/api/setup/status'),
  complete: (data: {
    admin_username: string
    admin_password: string
    smtp?: {
      host: string
      port: number
      username: string
      password: string
      from: string
      from_name: string
    }
  }) => post<{ status: string }>('/api/setup', data),
}

export { ApiError }
