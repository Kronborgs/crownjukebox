<div align="center">
  <img src="pics/Crownjukelogo.png" alt="CrownJukebox" width="220"/>

  # CrownJukebox

  **A self-hosted, retro-styled party jukebox — multi-user, real-time, no cloud required.**

  [![Release](https://img.shields.io/github/v/release/Kronborgs/crownjukebox)](https://github.com/Kronborgs/crownjukebox/releases)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
  [![Docker](https://img.shields.io/badge/docker-multi--arch-blue)](https://hub.docker.com/r/kronborgs/crownjukebox)
  [![Go](https://img.shields.io/badge/Go-backend-00ADD8)](https://go.dev/)
  [![React](https://img.shields.io/badge/React%2019-frontend-61DAFB)](https://react.dev/)
</div>

---

## What is CrownJukebox?

CrownJukebox is a **self-hosted jukebox server** you run at home or at your venue. It turns your local music collection into a shared, browser-based jukebox that multiple people can control from their own devices — no app install, no Spotify account, no cloud subscription.

The idea is simple: you put a screen (TV, monitor, or tablet) in your living room showing the **kiosk view** — the retro-styled "Now Playing" display with a vinyl animation, LED-scrolling track name, and audio controls. Your guests then open the jukebox on their **phone browser**, browse your music library, and add songs to the shared queue. Everything updates in real-time across all connected devices.

When the moment calls for it, whoever has permission can hit the **SKÅL!** button — and the entire screen explodes into a full-screen neon animation with confetti and a party track from your dedicated party playlist.

---

## Screenshots

### SKÅL! — full-screen party animation
![Party animation](pics/screenshot-party.png)

### Album browser — retro dial navigation
![Album browser](pics/screenshot-albums.png)

### Queue — see and manage what's coming up
![Queue](pics/screenshot-queue.png)

### Search — find any track in your library instantly
![Search](pics/screenshot-search.png)

### Admin panel — manage users, settings, and library
![Admin panel](pics/screenshot-admin.png)

---

## How it works

```
Your music files (MP3/FLAC)
        │
        ▼
  CrownJukebox backend (Go)
  ┌─────────────────────────────────────────┐
  │  Music scanner → SQLite library DB      │
  │  Cover art extractor → thumbnail cache  │
  │  Playback state machine                 │
  │  Queue manager (user + autoplay tracks) │
  │  SSE hub → pushes live events to all    │
  │  connected browsers instantly           │
  └─────────────────────────────────────────┘
        │                        │
        ▼                        ▼
  TV / Kiosk browser      Guest phones
  (NowPlaying + controls)  (Browse + Add to queue)
```

When someone adds a track, every connected browser knows within milliseconds — the queue, the now-playing display, and the audio all update in sync. No polling, no page refresh needed.

The **audio streams directly from the backend** to the kiosk browser. The kiosk is the speaker — guests just control what's playing.

---

## Key Features

### 🎵 Playback & Queue
- Streams MP3/FLAC directly from your files to the browser — no transcoding needed
- Shared queue visible to everyone in real-time
- Add, remove, and reorder tracks in the queue
- **Autoplay** — when the queue runs out, CrownJukebox automatically picks tracks from your library based on what hasn't been played recently. The moment a user adds a real track, autoplay steps aside and the user's track starts immediately
- Play / Pause / Skip with full position tracking
- Playback history per room
- **YouTube QR-to-queue** — guests scan a QR code in the Search tab, search YouTube on their phone, and add any song directly to the jukebox queue. yt-dlp downloads the audio in the background while the track is queued immediately

### 🎉 SKÅL! Party Mode
- One tap triggers a full-screen neon + confetti explosion on the kiosk
- A random track from your party playlist starts playing automatically
- Volume can be boosted automatically during the party moment
- Whatever was playing before is restored when the party track ends
- Permission-gated: only users you trust can trigger it

### 🎨 Retro UI
- Inspired by 1960s/70s jukeboxes — neon colours, chrome details, amber LED displays
- Vinyl record animation while music plays
- LED-scrolling track name for long titles
- **Kiosk layout** designed for a TV or wall-mounted screen: large NowPlaying view, tabbed navigation for Queue and Browse
- **Mobile layout** designed for phones: touch-friendly, fast to navigate and add tracks
- Smooth Framer Motion animations throughout
- First-run setup wizard — no config files to edit manually

### 📚 Music Library
- Recursively scans a mounted music directory for MP3, FLAC, and other audio formats
- Extracts cover art from audio tags (ID3 / FLAC metadata), falls back to `folder.jpg`, and generates a retro placeholder for albums with no art
- Generates and caches thumbnail images in multiple sizes for fast browsing
- Browse by artist → album → tracks using a retro dial selector
- Full-text search across tracks, albums, and artists
- Optional integration with a Subsonic/Navidrome server as an alternative music source

### 👥 Multi-user & Access Control
- **User accounts** with username + PIN — admin creates them, guests never need to register themselves
- **QR code guest access** — generate a scannable link (with optional expiry date) and print it or put it on a table card. Guests scan and are immediately logged in as a guest user
- **Email invitations** — send a login link directly to a user via SMTP
- **Permission flags** per user: `can_search`, `can_view_queue`, `can_add_to_queue`, `can_use_party_button` — full control over what each person can do
- **Session management** — admin can see all active logins and revoke any session instantly from the admin panel
- **Active player ownership** — only one device can "own" the audio output at a time. A second device sees a "Tag over" prompt instead of silently stealing playback
- **Revoking the last owner session pauses music** — if an admin logs out the last real user, playback stops automatically. No ghost music with nobody home
- Each user gets their own **room** (their own queue and playback context)

### ⚙️ Admin Panel
- Create, edit, enable/disable, extend expiry, or delete users
- Trigger a full library rescan or artwork-only rescan at any time
- Change all settings at runtime (autoplay on/off, SMTP config, guest permissions, audio settings, keyboard shortcuts) — no restart needed
- Manage QR access links: create new ones, set expiry, revoke instantly
- Assign a party playlist to each room
- Configure keyboard bindings for kiosk installs (useful for a physical button panel)
- **YouTube API key** — configure your Google YouTube Data API v3 key directly in Admin → YouTube. Never stored in environment variables or config files
- **Live jukebox overview** — the Jukeboxes tab shows every user's room: current track, queue length, active sessions (device, login time, last seen), and which device is the active audio player. Revoke any session with one click
- **"Playing with no owner" warning** — orange banner appears on any room that is playing music but has no logged-in owner session

### 🚀 Self-hosting & Deployment
- **Multi-arch Docker image** — runs on both `amd64` (regular PC/server) and `arm64` (Raspberry Pi 4/5, Apple Silicon)
- **Pure-Go SQLite** — no external database to install or maintain; all data in a single file with automatic schema migrations on startup
- **Portainer** — import `portainer-stack.yml` directly in Portainer Stacks
- **Unraid** — community template included
- Real-time updates via **Server-Sent Events** (SSE) — works through most firewalls and proxies; no WebSocket setup needed

---

## Quick Start

```bash
git clone https://github.com/Kronborgs/crownjukebox.git
cd crownjukebox
```

Edit `docker-compose.yml` and set at minimum:
- `ADMIN_PASSWORD` — your admin password
- `JWT_SECRET` — a long random string (e.g. `openssl rand -hex 32`)
- The volume path to your music: `/your/music:/music:ro`

Then start it:

```bash
docker compose up -d
```

Open `http://localhost:3000` in your browser. The **setup wizard** will guide you through the first-time configuration.

---

## docker-compose.yml example

```yaml
services:
  crownjukebox:
    image: ghcr.io/kronborgs/crownjukebox:latest
    ports:
      - "3000:80"
    volumes:
      - /your/music:/music          # your music library (read/write — needed for YouTube downloads)
      - /your/appdata:/data         # database + persistent app data
      - /your/artwork_cache:/artwork_cache  # album art thumbnail cache
    environment:
      JWT_SECRET: change-this-to-a-long-random-string
    restart: unless-stopped
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | *(required)* | Secret key for session tokens — **always change this** |
| `MUSIC_DIR` | `/music` | Path inside the container to your music directory |
| `DB_PATH` | `/data/crownjukebox.db` | SQLite database file path |
| `ARTWORK_CACHE_DIR` | `/artwork_cache` | Thumbnail cache directory |
| `EXTERNAL_MUSIC_DIR` | `/music/youtubedownload` | Where YouTube-downloaded tracks are saved |
| `SESSION_TTL_HOURS` | `168` | How long a login session lasts (hours) |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins — set to your domain in production |
| `ALLOW_GUEST_SEARCH` | `true` | Whether guests can search the library |
| `ALLOW_GUEST_QUEUE_ADD` | `true` | Whether guests can add tracks to the queue |
| `ALLOW_GUEST_PARTY_BUTTON` | `false` | Whether guests can trigger SKÅL! |
| `SUBSONIC_ENABLED` | `false` | Enable Subsonic/Navidrome as music source |
| `SUBSONIC_URL` | *(empty)* | Subsonic server base URL |
| `SUBSONIC_USERNAME` | *(empty)* | Subsonic username |
| `SUBSONIC_PASSWORD` | *(empty)* | Subsonic password |

---

## Deployment options

### Portainer
Import `portainer-stack.yml` in Portainer → Stacks → Web editor and fill in your environment variables.

### Unraid
Import `unraid-templates/crownjukebox.xml` via Unraid Community Applications, or add the template URL manually.

### Reverse proxy (nginx / Traefik)
The frontend container serves the React app on port 80. The backend API listens internally on port 8080 and is proxied by the frontend nginx config — you only need to expose the frontend port. Set `ALLOWED_ORIGINS` to your public domain.

---

## Building multi-arch images

```bash
# Requires: docker buildx configured and docker login
chmod +x build-multiarch.sh
./build-multiarch.sh 0.1.0
```

This builds and pushes `linux/amd64` + `linux/arm64` images in a single manifest.

---

## Architecture

```
frontend/          React 19 + TypeScript + Vite + Framer Motion + TanStack Query
backend/           Go + Chi v5 + modernc SQLite (pure Go — no CGO, no gcc needed)
  cmd/server/      Entry point — loads config, runs migrations, starts HTTP server
  internal/
    api/           HTTP handlers + Chi router — all REST endpoints
    auth/          JWT session tokens, auth middleware, QR login flow
    artwork/       Cover art extraction from audio tags, thumbnail generator, cache
    config/        Environment variable configuration with defaults
    db/            SQLite connection pool, schema migrations (runs on startup)
    email/         SMTP service for sending invite emails
    events/        SSE hub — broadcasts typed events to all connected browser clients
    music/         Recursive file scanner — builds the library in SQLite
    party/         SKÅL! engine — selects party tracks, manages party state
    playback/      Playback state machine (play/pause/skip/autoplay/history)
    queue/         Queue manager — user tracks + autoplay items, ordering
    rooms/         Per-user room management (each user = one room)
    subsonic/      Optional Subsonic/Navidrome API client
```

### Real-time events (SSE)

All live updates use Server-Sent Events. The backend broadcasts named events to room-specific subscribers:

| Event | Trigger |
|---|---|
| `now_playing_changed` | Track changes |
| `queue_changed` | Queue is modified |
| `playback_state_changed` | Play/pause/position update |
| `party_started` | SKÅL! triggered |
| `party_ended` | Party track finished, normal playback restored |
| `settings_changed` | Admin changes a setting |
| `user_access_revoked` | Admin revokes a user's access |
| `active_player_changed` | Active audio player device changes |

---

## Library Size & Capacity

CrownJukebox is not meaningfully limited by software — the real limit is your disk space.

### How much music can it hold?

A typical MP3 (256 kbps, ~4 minutes) is around **8 MB**. Here's what that means in practice:

| Disk space | Approx. tracks |
|---|---|
| 100 GB | ~12,500 |
| 500 GB | ~62,500 |
| 1 TB | ~125,000 |
| 4 TB | ~500,000 |
| 8 TB | ~1,000,000 |

Add ~1–2 GB for the artwork cache (3 thumbnail sizes per album) — negligible compared to the music itself.

### Why the software won't be your bottleneck

- **SQLite** supports up to 281 TB and billions of rows. 100,000 tracks of metadata is roughly 150 MB in the database — nothing.
- **The backend loads metadata on demand** — it doesn't load your whole library into RAM. With 2,000 tracks in the library, the Go process uses ~8–9 MB of RAM.
- **Search stays fast** — SQLite full-text search handles hundreds of thousands of tracks in under 100 ms.
- **Album browsing is paginated** — it doesn't matter if you have 100 or 100,000 albums.

The only thing that takes longer with a large library is the **initial scan** — but that runs once in the background and doesn't block playback.

**Short version: if your disk is big enough, CrownJukebox can handle it.**

---

## Changelog

### v0.2.0 — 2026-05-10

#### New Features

- **Active player ownership** — only one device can own the audio output at a time. When a second device opens the jukebox, it sees a "Tag over" banner instead of silently stealing playback from the first device. The takeover is always a conscious choice
- **"Tag over" prompt** — if another device is already playing, a banner appears: *"En anden enhed afspiller lyden. Tag over for at spille lyden her."* Tapping it claims the player role and syncs position seamlessly
- **Seek-on-claim** — when a device claims the player role, the audio element seeks to the exact position the previous player was at, preventing any jump in the music
- **Audio slider debounce** — volume, balance, tone, and mute controls are debounced (400 ms per setting) to prevent flooding the backend with requests while dragging a slider
- **Live session list in admin Jukeboxes panel** — each jukebox card now shows all active sessions: device name, login time, last-seen time, device type icon (desktop/mobile), GÆST badge, and a 🔊 AFSPILLER badge for the current audio owner. Revoke any session with one click directly from the panel
- **"Playing with no owner" warning** — orange warning banner on any jukebox card that is playing music but has no logged-in owner session
- **Auto-pause on last owner revoke** — revoking the last non-guest session for a room via the admin panel now automatically pauses playback and clears the active player role. Music no longer keeps playing with nobody home
- **Autoplay skips boot if no owner is logged in** — on server startup, autoplay only kicks in for rooms where the owner has an active session. Rooms with no logged-in user start silent
- **Instant logout on session expiry** — if the server revokes your session (e.g. an admin logs you out), the browser detects the 401 immediately and shows the login screen without requiring a page refresh
- **401 polling guard** — the admin panel stops its auto-refresh polling the moment a request returns 401, preventing an infinite loop of unauthenticated requests in the server logs

#### Bug Fixes

- **Music kept playing after admin revoked owner session** — `handleAdminRevokeSession` now checks if the revoked session was the active player, clears it, and pauses if no owner sessions remain
- **Admin panel spammed 401s after self-revoke** — `refetchInterval` now returns `false` on any query error, and `retry: false` prevents the default retry burst
- **Stale position on player claim** — `resumePositionRef` is now set from the latest server state at claim time, not from a stale closure value

---

### v0.1.2 — 2026-05-10

#### New Features
- **YouTube QR-to-queue** — guests scan a QR code shown in the Search tab, opens a mobile YouTube search page (`/connect`). They search for any song, tap `+`, and it's added to the jukebox queue immediately. yt-dlp downloads the audio in the background while the track is already queued and ready to play
- **YouTube API key in admin panel** — configure your Google YouTube Data API v3 key directly in Admin → YouTube. Never stored in environment variables
- **Background download with immediate queue** — track metadata is fetched first (~2s), track is queued right away, audio download happens in the background. Stream handler waits for the file if playback reaches the track before download completes
- **Multi-arch yt-dlp** — architecture-specific yt-dlp binary installed at image build time (amd64 + arm64), so YouTube downloads work on Unraid and Raspberry Pi without any manual setup

#### Bug Fixes
- **Audio CORS (Web Audio API outputting silence)** — added explicit `Access-Control-Allow-Origin: *` headers on the stream endpoint + `crossOrigin="anonymous"` on the audio element. Required for `createMediaElementSource` to work cross-origin
- **QR code showed localhost URL** — the connect URL now uses the browser's `Origin` header, so QR codes always contain the real public URL (e.g. `https://jukeboxen.kronborgs.dk`) instead of `localhost:8080`
- **Blank page on QR modal (React error #130)** — fixed `import QRCode` default import which resolved to the module object in production Vite builds; changed to named import `{ QRCode }`
- **CI/CD not building on master** — GitHub Actions workflow only triggered on `main`; added `master` branch trigger and `latest` tag on master push
- **npm ci failing in Docker build** — local npm 11 generates lockfileVersion 3; switched Docker builder to `node:24` + `npm install` to match
- **`exec format error` for yt-dlp on arm64** — switched from amd64-only binary download to architecture-specific binary selection at build time

---

### v0.1.1 — 2026-05-01

#### New Features
- **Festive invitation email** — sending a user an invite now generates a beautifully styled neon HTML email with their login credentials (username + initial PIN), a one-click access link, and a prompt to change their PIN on first login
- **Email = username** — the email address is the username. No separate username field when creating users
- **Force PIN change on first login** — admin sets an initial PIN; the user is immediately prompted to choose their own personal PIN after logging in for the first time with the admin-assigned code
- **Auto-detect jukebox URL** — invitation links now automatically use `window.location.origin` (the URL the admin's browser is open on), so links work without any manual URL configuration
- **Jukebox URL setting** — optional override in Admin → Indstillinger if the public URL differs from the admin's browser URL
- **Datetime picker for access expiry** — choose an exact date and time for when a guest's access expires, instead of entering a number of minutes
- **Auto-start autoplay on boot** — if the jukebox is idle when the server starts, autoplay kicks in automatically without requiring a first manual play
- **Stream route indicator** — the dashboard and Now Playing display show whether audio is streaming direct or via the local backend, with a clickable link to the stream URL
- **Direct stream URL bypass** — configure an external URL (e.g. an Icecast stream) that the kiosk browser uses instead of the local backend stream
- **Logout button in admin panel** — logout button added to the admin panel header

#### Bug Fixes
- **Progress bar always showed 0%** — fixed by reading duration from the browser's audio element instead of the database
- **Direct stream URL treated as relative path** — fixed using the URL constructor to properly resolve absolute URLs
- **Delete user silently failed** — SQLite foreign key constraints caused DELETE to be blocked; fixed by nulling FK references before deleting the user
- **Audio didn't restart when same track was selected** — fixed so the audio element always reloads even if the track ID hasn't changed
- **Search screen double-fires** — added debounce to search input to prevent excessive API calls
- **Duplicate queue add returned 400** — changed to return 200 with the existing item instead of an error
- **Frontend build broken** — fixed an extra `</div>` tag that broke the Vite build
- **Stream URL missing scheme** — auto-prepend `https://` if the configured direct stream URL has no scheme
- **Settings/audio race condition** — fixed a race between the settings load and audio source update that could cause the wrong stream URL to be used on startup
- **Login security hardening** — added rate limiting and constant-time responses to prevent credential stuffing and user enumeration

---

### v0.1.0 — initial release

First public release. See the [v0.1.0 release notes](https://github.com/Kronborgs/crownjukebox/releases/tag/v0.1.0).

---

## License

MIT — use it, host it, fork it, share it.
