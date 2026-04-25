# CrownJukebox

En retro browser-baseret party jukebox inspireret af klassiske 1960'er/70'er jukeboxes.

## Features

- **Retro UI** — neon farver, chrome detaljer, vinyl-animationer
- **Album art** — automatisk udtrækning fra MP3/FLAC tags + folder.jpg fallback + retro placeholder
- **SSE live updates** — kø, afspilning og party-knap synkroniseret i realtid
- **SKÅL! party-knap** — konfetti + neon-animation + tilfældig party-sang
- **QR-kode gæstelogin** — generer QR-links til midlertidige gæster
- **Admin panel** — brugeradministration, scanning, indstillinger
- **Multi-arch Docker** — kører på amd64 og arm64 (Raspberry Pi 4/5)

## Quick Start

```bash
# 1. Klon repo
git clone https://github.com/crownjukebox/crownjukebox.git
cd crownjukebox

# 2. Kopier og udfyld env-fil
cp .env.example .env
nano .env   # Sæt MUSIC_DIR og ADMIN_PASSWORD

# 3. Start med docker-compose
docker compose up -d

# 4. Åbn i browser
open http://localhost:3000
```

## Miljøvariabler

| Variabel            | Standard                | Beskrivelse                              |
|---------------------|-------------------------|------------------------------------------|
| `ADMIN_USERNAME`    | `admin`                 | Admin brugernavn                         |
| `ADMIN_PASSWORD`    | `changeme`              | Admin PIN/password                       |
| `JWT_SECRET`        | *(skal ændres)*         | Hemmelig nøgle til session-tokens        |
| `MUSIC_DIR`         | `./music`               | Sti til musikmappen (monteres read-only) |
| `FRONTEND_PORT`     | `3000`                  | Port til frontend                        |
| `SESSION_TTL_HOURS` | `168`                   | Session-levetid i timer (standard 7 dage)|
| `SUBSONIC_URL`      | *(tom)*                 | Valgfri Subsonic/Navidrome URL           |

## Arkitektur

```
frontend/          React 18 + TypeScript + Vite + Framer Motion
backend/           Go 1.22 + Chi v5 + modernc SQLite (pure Go)
  cmd/server/      Indgangspunkt
  internal/
    api/           HTTP handlers + router
    auth/          Session, middleware, QR-login
    artwork/       Cover art udtrækning + thumbnails + placeholders
    db/            SQLite connection + migrations
    events/        SSE hub
    music/         Musik-scanner
    party/         SKÅL-engine
    playback/      Afspilningstilstand
    queue/         Køstyring
    subsonic/      Valgfri Subsonic/Navidrome klient
```

## Multi-arch build

```bash
# Kræver: docker buildx + docker login
chmod +x build-multiarch.sh
./build-multiarch.sh 1.0.0
```

## Portainer

Brug `portainer-stack.yml` direkte i Portainer → Stacks → Web editor.

## Unraid

Importer `unraid-template.xml` i Unraid Community Applications.

## Database

SQLite med WAL-mode. Databasefilen gemmes i `/data/crownjukebox.db`.

## Licens

MIT
