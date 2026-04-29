<div align="center">
  <img src="pics/Crownjukelogo.png" alt="CrownJukebox" width="200"/>

  # CrownJukebox

  **A retro browser-based party jukebox — self-hosted, multi-user, real-time.**

  [![Release](https://img.shields.io/github/v/release/Kronborgs/crownjukebox)](https://github.com/Kronborgs/crownjukebox/releases)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
  [![Docker](https://img.shields.io/badge/docker-multi--arch-blue)](https://hub.docker.com/r/kronborgs/crownjukebox)
</div>

---

CrownJukebox turns your local music collection into a shared party jukebox. Guests join via QR code from their phones, browse albums, and add tracks to a shared queue — all synced live via Server-Sent Events. When the mood hits, hit **SKÅL!** for a full-screen party moment with confetti and a random party track.

## Screenshots

> Screenshots coming soon — upload them to `pics/` and they'll appear here.

| Kiosk view | Mobile view |
|---|---|
| `pics/screenshot-kiosk.png` | `pics/screenshot-mobile.png` |

| SKÅL! party animation | Admin panel |
|---|---|
| `pics/screenshot-party.png` | `pics/screenshot-admin.png` |

| Album browser | Search |
|---|---|
| `pics/screenshot-albums.png` | `pics/screenshot-search.png` |

## Features

### Playback & Queue
- **Audio streaming** — streams MP3/FLAC directly from local files to the browser
- **Shared queue** — add, remove, and reorder tracks; all users see the same queue live
- **Autoplay** — fills silence automatically when the queue runs out; stops instantly when a user adds a track
- **Play / Pause / Skip** — full playback controls with position tracking and history
- **Real-time sync** — every client updated instantly via SSE (`now_playing_changed`, `queue_changed`, etc.)

### SKÅL! Party Mode
- **Party button** — one tap triggers a full-screen neon + confetti animation
- **Party playlist** — each room can have a dedicated party playlist; a random track plays automatically
- **Permission control** — party button access can be restricted to specific users

### Music Library
- **Local scanner** — indexes MP3, FLAC, and other audio files recursively from a mounted music directory
- **Artist & album browsing** — retro dial-style navigation through your collection
- **Search** — fast full-text search across tracks, albums, and artists (permission-gated)
- **Cover art** — auto-extracted from audio tags (ID3/FLAC), `folder.jpg` fallback, retro placeholder for missing art
- **Artwork thumbnails** — background thumbnail generation and cache; missing-artwork rescan tool
- **Subsonic/Navidrome** — optional integration with an external Subsonic-compatible server

### Multi-user & Access Control
- **User accounts** — admin creates accounts with username + PIN; full CRUD in admin panel
- **QR guest access** — generate scannable QR links with optional expiry; guests join without creating an account
- **Email invitations** — SMTP-based invite flow sends login links directly to users
- **Permission system** — granular flags: `can_search`, `can_view_queue`, `can_add_to_queue`, `can_use_party_button`
- **Guest defaults** — configurable defaults for whether guests can search, queue, or use the party button
- **Session management** — admin can list and revoke active sessions
- **Multi-room** — each user gets their own jukebox room; admin can manage all rooms

### Admin Panel
- **User management** — create, edit, enable/disable, extend expiry, delete users
- **Library rescan** — trigger a full or artwork-only rescan at any time
- **Settings** — update all runtime settings (autoplay, SMTP, guest permissions, keyboard bindings) without restart
- **Keyboard bindings** — configurable keyboard shortcuts for kiosk installs
- **Access links** — create, list, and revoke QR/guest access links
- **Playlists** — manage playlists and assign them as party playlists per room

### UI / UX
- **Retro aesthetic** — neon colours, chrome details, vinyl record animation, amber displays
- **Kiosk layout** — full-screen TV/monitor view with tabbed navigation (Now Playing, Queue, Browse)
- **Mobile layout** — touch-friendly phone view for guests adding tracks from their sofa
- **First-run setup wizard** — guided setup on first launch; no manual config file needed
- **Framer Motion animations** — smooth transitions throughout

### Self-hosting
- **Multi-arch Docker** — single image runs on `amd64` and `arm64` (Raspberry Pi 4/5)
- **Portainer stack** — deploy with one click via `portainer-stack.yml`
- **Unraid template** — available via Unraid Community Applications
- **Pure-Go SQLite** — no external database; data lives in a single `/data/crownjukebox.db` file with WAL mode and automatic migrations

---

## Quick Start

```bash
git clone https://github.com/Kronborgs/crownjukebox.git
cd crownjukebox

# Edit docker-compose.yml to set your MUSIC_DIR, ADMIN_PASSWORD, and JWT_SECRET
docker compose up -d

# Open in browser
open http://localhost:3000
```

On first launch the setup wizard will guide you through creating your admin account.

## docker-compose.yml

```yaml
services:
  backend:
    image: ghcr.io/kronborgs/crownjukebox-backend:latest
    volumes:
      - /your/music:/music:ro
      - crownjukebox_data:/data
    environment:
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: your-secure-password
      JWT_SECRET: change-this-to-a-random-string
      MUSIC_DIR: /music
    restart: unless-stopped

  frontend:
    image: ghcr.io/kronborgs/crownjukebox-frontend:latest
    ports:
      - "3000:80"
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  crownjukebox_data:
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | Admin username |
| `ADMIN_PASSWORD` | *(required)* | Admin PIN / password |
| `JWT_SECRET` | *(required)* | Secret key for session tokens — **change this** |
| `MUSIC_DIR` | `/music` | Path to your music directory (mounted read-only) |
| `DB_PATH` | `/data/crownjukebox.db` | SQLite database path |
| `ARTWORK_CACHE_DIR` | `/data/artwork-cache` | Thumbnail cache directory |
| `SESSION_TTL_HOURS` | `24` | Session lifetime in hours |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins (comma-separated) |
| `ALLOW_GUEST_SEARCH` | `true` | Allow guests to use search |
| `ALLOW_GUEST_QUEUE_ADD` | `true` | Allow guests to add tracks to the queue |
| `ALLOW_GUEST_PARTY_BUTTON` | `false` | Allow guests to use the SKÅL! button |
| `SUBSONIC_ENABLED` | `false` | Enable Subsonic/Navidrome integration |
| `SUBSONIC_URL` | *(empty)* | Subsonic server URL |
| `SUBSONIC_USERNAME` | *(empty)* | Subsonic username |
| `SUBSONIC_PASSWORD` | *(empty)* | Subsonic password |

## Portainer

Import `portainer-stack.yml` directly in Portainer → Stacks → Web editor.

## Unraid

Import `unraid-templates/crownjukebox.xml` via Unraid Community Applications.

## Multi-arch Build

```bash
# Requires: docker buildx + docker login
chmod +x build-multiarch.sh
./build-multiarch.sh 0.1.0
```

## Architecture

```
frontend/          React 19 + TypeScript + Vite + Framer Motion + TanStack Query
backend/           Go + Chi v5 + modernc SQLite (pure Go, no CGO)
  cmd/server/      Entry point
  internal/
    api/           HTTP handlers + router (Chi)
    auth/          JWT sessions, middleware, QR login
    artwork/       Cover art extraction, thumbnails, placeholders
    config/        Environment variable config
    db/            SQLite + auto-migrations
    email/         SMTP invite emails
    events/        SSE hub (real-time push to all clients)
    music/         Recursive music file scanner
    party/         SKÅL! engine — party track selection + animation trigger
    playback/      Playback state machine (play/pause/skip/autoplay)
    queue/         Queue manager (add/remove/reorder/autoplay items)
    rooms/         Multi-room management
    subsonic/      Optional Subsonic/Navidrome client
```

## License

MIT
