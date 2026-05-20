# CrownJukebox — Production Readiness Review

> Udført: April 2026 · Reviewer: QA Lead / Release Engineer  
> Scope: Kodebase-gennemgang, konkrete testplaner, hardening-liste, release-tjekliste

---

## 1. Build Verification

### 1.1 Backend build-kommandoer

```powershell
cd backend

# 1. Ryd op i afhængigheder
go mod tidy
# Forventet: ingen output, go.sum opdateret

# 2. Statisk analyse
go vet ./...
# Forventet: ingen output

# 3. Kør tests (ingen eksisterer endnu — se afsnit 3)
go test ./... -v -timeout 60s
# Forventet: PASS eller "no test files" per pakke

# 4. Byg binær til lokal platform
go build -ldflags="-s -w" -o crownjukebox ./cmd/server
# Forventet: crownjukebox.exe / crownjukebox oprettes

# 5. Cross-compile til linux/amd64
$env:GOOS="linux"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -ldflags="-s -w" -o crownjukebox-linux-amd64 ./cmd/server
# Forventet: binær ~18-25 MB

# 6. Cross-compile til linux/arm64
$env:GOOS="linux"; $env:GOARCH="arm64"; $env:CGO_ENABLED="0"
go build -ldflags="-s -w" -o crownjukebox-linux-arm64 ./cmd/server
# Forventet: binær ~18-25 MB

# 7. Nulstil miljøvariabler
Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED
```

> ⚠️ **FUND:** `Dockerfile` bruger `golang:1.22-alpine` men `go.mod` erklærer `go 1.26.1`.
> Skal rettes til `golang:1.26-alpine` ellers fejler Docker build.

### 1.2 Frontend build-kommandoer

```powershell
cd frontend

# 1. Installér afhængigheder
npm install
# Forventet: 0 vulnerabilities (kør npm audit)

# 2. Type-tjek
npx tsc --noEmit
# Forventet: ingen output

# 3. Lint
npx eslint . --ext ts,tsx
# Forventet: 0 errors, 0 warnings

# 4. Unit tests (ingen eksisterer endnu — se afsnit 4)
npm test
# Forventet: kræver Vitest / Jest-opsætning

# 5. Produktionsbyg
npm run build
# Forventet: dist/ oprettet, ~1986 modules
```

### 1.3 Docker build-kommandoer

```bash
# Fra rod-mappen

# 1. Bygning med docker compose
docker compose build --no-cache

# 2. Start services
docker compose up -d

# 3. Tjek backend healthcheck
docker compose ps
# Forventet: backend status = healthy efter ~45s

# 4. Tjek frontend er tilgængeligt
curl http://localhost:3000
# Forventet: 200 OK, HTML med React-app

# 5. Tjek API-endpoint
curl http://localhost:3000/api/playback/state -H "X-Session-Token: ..."
# Forventet: JSON med is_playing, current_track

# 6. Tjek volume-montering
docker compose exec backend ls /music
# Forventet: dine musikfiler synlige

docker compose exec backend ls /data
# Forventet: crownjukebox.db

docker compose exec backend ls /artwork_cache
# Forventet: originals/ thumbs/

# 7. Test graceful shutdown
docker compose stop backend
docker compose start backend
# Forventet: kø og afspilningsstatus genoprettet fra DB
```

### 1.4 Multi-arch Docker build

```bash
# Kræver docker buildx og login til ghcr.io

# Opret builder hvis ikke eksisterer
docker buildx create --use --name multiarch

# Backend
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t ghcr.io/kronborgs/crownjukebox-backend:latest \
  ./backend

# Frontend
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t ghcr.io/kronborgs/crownjukebox-frontend:latest \
  ./frontend

# Test amd64 image starter
docker run --rm --platform linux/amd64 \
  -e DB_PATH=/tmp/test.db \
  -e MUSIC_DIR=/tmp \
  ghcr.io/kronborgs/crownjukebox-backend:latest
# Forventet: starter op, lytter på port 8080

# Test arm64 image via QEMU (på amd64 maskine)
docker run --rm --platform linux/arm64 \
  -e DB_PATH=/tmp/test.db \
  -e MUSIC_DIR=/tmp \
  ghcr.io/kronborgs/crownjukebox-backend:latest
# Forventet: starter op, lytter på port 8080
```

> ⚠️ **FUND:** `docker-compose.yml` bruger `image: crownjukebox/backend:latest` (lokal) men  
> README refererer til `ghcr.io/kronborgs/...`. Skal harmoniseres til én kilde.

---

## 2. Smoke Test Plan (15-30 min)

*Kør fra frisk docker compose up. Marker status: ✅ OK / ❌ FEJL / ⏩ SPRING OVER*

### Admin flow

| ID | Test | Trin | Forventet resultat | Status |
|----|------|------|--------------------|--------|
| A01 | Første admin login | Åbn localhost:3000, log ind med admin/[ADMIN_PASSWORD] | Login lykkes, admin-tab synlig | |
| A02 | Opret gæstebruger | Admin → Users → Ny bruger, udfyld navn, pin, rolle=gæst, varighed=4t | Bruger vises i liste, token genereres | |
| A03 | Generer QR-login | Admin → Users → [gæst] → Generer QR | QR-billede vises som PNG, link er aktivt | |
| A04 | Deaktivér gæstebruger | Admin → Users → [gæst] → Deaktivér | Status skifter til inaktiv, SSE udsender user_access_expired | |
| A05 | Genaktivér gæstebruger | Admin → Users → [gæst] → Aktivér | Status skifter til aktiv | |
| A06 | Ændr adgangsudløb | Admin → Users → [gæst] → Rediger → sæt udløb +2 timer | Ny expires_at gemt korrekt | |
| A07 | Vælg Skåle-playliste | Admin → Library → vælg en playliste → "Brug til SKÅLE" | Playliste markeret, ★ vises | |
| A08 | Scan musikbibliotek | Admin → Library → Scan | Scan starter, antal spor vises når færdig | |

### Gæst flow

| ID | Test | Trin | Forventet resultat | Status |
|----|------|------|--------------------|--------|
| G01 | QR-login via mobil | Scan QR-koden fra A03 med telefon | Login lykkes, gæste-UI vises | |
| G02 | Søg efter sang | Søge-tab → skriv "Beatles" | Resultater vises med cover art | |
| G03 | Tilføj sang til kø | Klik "Tilføj" på søgeresultat | Sang tilføjes, kø-counter opdateres | |
| G04 | Se kø | Kø-tab | Sangens titel, artist og cover vises | |
| G05 | Se Now Playing | Vent til sang starter | Album art, titel, artist vises | |
| G06 | Udløbet adgang blokeres | Vent til adgang udløber (eller deaktivér fra admin) | Gæst vises logout-besked, kan ikke interagere | |

### Musik og bibliotek

| ID | Test | Trin | Forventet resultat | Status |
|----|------|------|--------------------|--------|
| M01 | MP3 scannes | Placer test.mp3 i MUSIC_DIR, kør scan | Sang vises i bibliotek | |
| M02 | FLAC scannes | Placer test.flac i MUSIC_DIR, kør scan | FLAC vises med korrekt metadata | |
| M03 | Metadata vises korrekt | Klik på album | Titel, artist, år, genre vises korrekt | |
| M04 | Album art fra tag | MP3 med embedded cover | Cover vises korrekt, ikke placeholder | |
| M05 | Album art fra folder.jpg | Album-mappe med folder.jpg | Cover vises korrekt | |
| M06 | Missing artwork placeholder | Album uden cover | Retro placeholder-billede vises | |
| M07 | Cover endpoint cache | Åbn /api/library/cover/[id] to gange | Anden request: Cache-Control header til stede | |

### Playback

| ID | Test | Trin | Forventet resultat | Status |
|----|------|------|--------------------|--------|
| P01 | Start afspilning | Tilføj sang til kø, klik Play | Sang starter, now playing opdateres | |
| P02 | Næste sang i kø | Vent til sang slutter (eller seek til slutning) | Næste sang i køen starter automatisk | |
| P03 | Kø ikke afbrudt | Tilføj sang til kø mens en anden spiller | Nuværende sang færdiggøres, kø respekteres | |
| P04 | Autoplay ved tom kø | Tøm køen, vent til nuværende sang slutter | Autoplay-sang starter automatisk | |
| P05 | Bruger-valgt afbryder autoplay | Tilføj sang midt i autoplay | Brugervalgt sang starter næste | |
| P06 | SKÅLE afbryder aktuel sang | Tryk SKÅLE-knap | Konfetti + party-sang starter | |
| P07 | Kø genoptages efter SKÅLE | Vent til party-sang slutter | Kø genoptages, party mode slutter | |
| P08 | Track-ended kald | Lyt i browser devtools/network tab under sang | POST /api/playback/track-ended kaldes | |

### UI og enheder

| ID | Test | Trin | Forventet resultat | Status |
|----|------|------|--------------------|--------|
| U01 | Kiosk 1080p landscape | Åbn i Chrome 1920×1080 | Layout fylder skærmen, ingen scrollbar | |
| U02 | Kiosk 1080p portrait | Åbn i Chrome 1080×1920 | Layout roterer/tilpasser sig | |
| U03 | Mobil browser | Åbn på iPhone/Android | Touch-venligt layout, knapper store nok | |
| U04 | Tablet browser | Åbn på tablet 768×1024 | Layout tilpasser sig, covers synlige | |
| U05 | On-screen keyboard | Aktivér kiosk-mode, brug søgefelt | Tastatur vises uden ekstern tastatur | |
| U06 | Keyboard navigation | Tab/Enter navigation | Fokusmarkering synlig, logisk rækkefølge | |

### Deployment

| ID | Test | Trin | Forventet resultat | Status |
|----|------|------|--------------------|--------|
| D01 | Restart mister ikke data | docker compose restart | Kø og brugere intakt, DB-volume bevaret | |
| D02 | Image-opdatering beholder data | docker compose pull && up | Ny container, samme DB-data | |
| D03 | Musik-volume read-only | docker compose exec backend touch /music/test | Permission denied | |

---

## 3. Integration Test Plan (Go)

### 3.1 Teststruktur

```
backend/
  internal/
    auth/
      middleware_test.go
      session_test.go
    queue/
      manager_test.go
    playback/
      state_test.go
    party/
      engine_test.go
    api/
      handlers_test.go        # HTTP handler integration tests
      testhelpers_test.go     # shared setup
  testdata/
    fixtures/
      users.sql
      tracks.sql
      albums.sql
    audio/
      silence_3s.mp3          # 3 sekunders stille MP3 (ffmpeg -f lavfi -i anullsrc ...)
      silence_3s.flac
```

### 3.2 Test database og fixtures

```go
// backend/internal/api/testhelpers_test.go
package api_test

import (
    "testing"
    "github.com/jmoiron/sqlx"
    "github.com/crownjukebox/crownjukebox/internal/db"
    "github.com/crownjukebox/crownjukebox/internal/api"
    "github.com/crownjukebox/crownjukebox/internal/config"
)

func newTestServer(t *testing.T) (*api.Server, *sqlx.DB) {
    t.Helper()
    // Brug in-memory SQLite
    database, _ := db.Open(":memory:")
    db.Migrate(database)

    cfg := &config.Config{
        MusicDir:        t.TempDir(),
        ArtworkCacheDir: t.TempDir(),
        AllowedOrigins:  "*",
        SessionTTLHours: 24,
    }

    srv := api.NewServer(cfg, database)
    t.Cleanup(func() { database.Close() })
    return srv, database
}

func seedAdminUser(t *testing.T, database *sqlx.DB) (userID, token string) {
    // Indsæt admin + session direkte i DB
    // ...
    return
}
```

### 3.3 Konkrete tests

```go
// backend/internal/auth/middleware_test.go

func TestRequireAuth_NoToken_Returns401(t *testing.T) { ... }
func TestRequireAuth_ValidToken_PopulatesContext(t *testing.T) { ... }
func TestRequireAuth_ExpiredSession_Returns401(t *testing.T) { ... }
func TestRequireAuth_RevokedSession_Returns401(t *testing.T) { ... }
func TestRequireAdmin_GuestRole_Returns403(t *testing.T) { ... }
func TestRequirePermission_MissingPerm_Returns403(t *testing.T) { ... }
func TestRequirePermission_AdminBypassesPerm(t *testing.T) { ... }
```

```go
// backend/internal/queue/manager_test.go

func TestAddTrack_ValidTrack_IncreasesQueueLength(t *testing.T) { ... }
func TestAddTrack_InvalidTrackID_ReturnsError(t *testing.T) { ... }
func TestGetQueue_ReturnsRichItems_WithArtistAlbum(t *testing.T) { ... }
func TestAutoplayNext_EmptyHistory_ReturnsRandomTrack(t *testing.T) { ... }
func TestAutoplayNext_RecentTracks_AvoidsRepetition(t *testing.T) { ... }
func TestAutoplayNext_EmptyLibrary_ReturnsError(t *testing.T) { ... }
func TestReorder_ValidIDs_UpdatesPositions(t *testing.T) { ... }
```

```go
// backend/internal/playback/state_test.go

func TestPlay_ValidTrack_SetsCurrentTrack(t *testing.T) { ... }
func TestTrackEnded_QueueNotEmpty_PlaysNext(t *testing.T) { ... }
func TestTrackEnded_EmptyQueue_StartsAutoplay(t *testing.T) { ... }
func TestTrackEnded_PartyTrack_CallsEndParty(t *testing.T) { ... }
func TestPause_WhenPlaying_StopsPlayback(t *testing.T) { ... }
```

```go
// backend/internal/api/handlers_test.go

func TestHandleCoverArt_MissingID_ServesPlaceholder(t *testing.T) { ... }
func TestHandleCoverArt_ValidID_ServesCachedImage(t *testing.T) { ... }
func TestHandleStream_PathTraversal_Returns400(t *testing.T) { ... }
func TestHandleStream_ValidTrack_Streams200(t *testing.T) { ... }
func TestHandleSearch_ReturnsTracksArtistsAlbums(t *testing.T) { ... }
func TestHandleQRLogin_ExpiredToken_Returns401(t *testing.T) { ... }
func TestSSE_ConnectAndReceiveEvent(t *testing.T) { ... }
```

### 3.4 Subsonic mock

```go
// backend/internal/subsonic/mock_server_test.go

func newSubsonicMock(t *testing.T) *httptest.Server {
    mux := http.NewServeMux()
    mux.HandleFunc("/rest/ping.view", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        fmt.Fprint(w, `{"subsonic-response":{"status":"ok","version":"1.16.1"}}`)
    })
    // ... getSongs, getCoverArt etc.
    return httptest.NewServer(mux)
}
```

### 3.5 CI (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.26' }
      - run: cd backend && go mod tidy && go vet ./... && go test ./... -timeout 60s

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd frontend && npm ci && npx tsc --noEmit && npx eslint .
```

---

## 4. Frontend E2E Test Plan (Playwright)

### 4.1 Opsætning

```bash
cd frontend
npm install -D @playwright/test
npx playwright install chromium firefox webkit
```

```typescript
// frontend/playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop-1080p', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'portrait-1080p', use: { viewport: { width: 1080, height: 1920 } } },
    { name: 'mobile', use: { ...devices['iPhone 14'] } },
    { name: 'tablet', use: { ...devices['iPad Pro 11'] } },
  ],
});
```

### 4.2 Eksempel Playwright tests

```typescript
// frontend/e2e/admin.spec.ts

test('admin login', async ({ page }) => {
  await page.goto('/');
  await page.fill('[data-testid="username"]', 'admin');
  await page.fill('[data-testid="password"]', process.env.ADMIN_PASSWORD!);
  await page.click('[data-testid="login-btn"]');
  await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible();
});

test('opret gæstebruger', async ({ page }) => {
  // login som admin
  await adminLogin(page);
  await page.click('[data-testid="users-tab"]');
  await page.click('[data-testid="create-user-btn"]');
  await page.fill('[data-testid="display-name"]', 'Testgæst');
  await page.fill('[data-testid="username"]', 'guest1');
  await page.fill('[data-testid="pin"]', '1234');
  await page.click('[data-testid="save-user-btn"]');
  await expect(page.locator('text=Testgæst')).toBeVisible();
});

test('QR login flow', async ({ page, context }) => {
  // Generér QR som admin, hent URL fra API, åbn i ny side
  await adminLogin(page);
  const res = await page.request.post('/api/admin/users/guest1/access-link');
  const { url } = await res.json();
  
  const guestPage = await context.newPage();
  await guestPage.goto(url);
  await expect(guestPage.locator('[data-testid="jukebox"]')).toBeVisible();
});
```

```typescript
// frontend/e2e/playback.spec.ts

test('tilføj sang og se kø', async ({ page }) => {
  await userLogin(page);
  await page.click('[data-testid="search-tab"]');
  await page.fill('[data-testid="search-input"]', 'test');
  await page.waitForSelector('[data-testid="track-result"]');
  await page.click('[data-testid="track-result"]:first-child [data-testid="add-to-queue"]');
  await page.click('[data-testid="queue-tab"]');
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(1);
});

test('skåle-knap viser konfetti', async ({ page }) => {
  await adminLogin(page);
  await page.click('[data-testid="party-btn"]');
  // canvas-confetti er svær at teste direkte — tjek UI feedback
  await expect(page.locator('[data-testid="party-overlay"]')).toBeVisible();
});

test('adgang udløbet viser logout', async ({ page }) => {
  await userLogin(page);
  // Simuler SSE-event user_access_expired
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('test:access-expired'));
  });
  await expect(page.locator('[data-testid="access-expired-msg"]')).toBeVisible();
});
```

```typescript
// frontend/e2e/keyboard.spec.ts

test('tastatur-navigation i søgning', async ({ page }) => {
  await userLogin(page);
  await page.keyboard.press('Tab'); // fokus til søgefelt
  await page.keyboard.type('test');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="track-result"]');
  await page.keyboard.press('Tab'); // fokus til første resultat
  await page.keyboard.press('Enter'); // tilføj til kø
  await expect(page.locator('[data-testid="queue-count"]')).toHaveText('1');
});

test('on-screen keyboard vises i kiosk-mode', async ({ page }) => {
  await page.addInitScript(() => { window.__KIOSK_MODE__ = true; });
  await page.goto('/');
  await userLogin(page);
  await page.click('[data-testid="search-tab"]');
  await page.click('[data-testid="search-input"]');
  await expect(page.locator('[data-testid="onscreen-keyboard"]')).toBeVisible();
});
```

### 4.3 Viewports testet

| Viewport | Beskrivelse | Playwright device/size |
|----------|-------------|------------------------|
| 1920×1080 | Kiosk landscape | `{ width: 1920, height: 1080 }` |
| 1080×1920 | Kiosk portrait | `{ width: 1080, height: 1920 }` |
| 390×844 | iPhone 14 | `devices['iPhone 14']` |
| 820×1180 | iPad Pro | `devices['iPad Pro 11']` |

---

## 5. Performance Review

### 5.1 Mål og grænser

| Måling | Mål | Kritisk grænse |
|--------|-----|----------------|
| Søgning (10k spor) | < 50 ms | < 200 ms |
| Søgning (100k spor) | < 200 ms | < 1000 ms |
| Album browser første load | < 1 s | < 3 s |
| Cover art (cache hit) | < 5 ms | < 50 ms |
| Cover art (cache miss) | < 500 ms | < 2000 ms |
| Queue GET | < 20 ms | < 100 ms |
| Scan (lokal disk) | > 500 spor/min | > 100 spor/min |
| Startup til første request | < 5 s | < 15 s |
| SSE 50 samtidige klienter | < 10 MB RAM ekstra | < 50 MB |
| Docker startup til healthy | < 30 s | < 60 s |

### 5.2 Identificerede risici

**P0 — Manglende indekser på SQLite:**

```sql
-- Søgning er O(n) uden indeks. Mangler at bekræfte om disse eksisterer:
CREATE INDEX IF NOT EXISTS idx_tracks_title       ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_artists_name       ON artists(name);
CREATE INDEX IF NOT EXISTS idx_albums_title       ON albums(title);
CREATE INDEX IF NOT EXISTS idx_tracks_album_id    ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_queue_position     ON queue_items(position);
CREATE INDEX IF NOT EXISTS idx_history_started_at ON playback_history(started_at);
```

Bekræft at migrationsfilen inkluderer disse. Uden indeks vil søgning i 50k-100k spor tage > 5 sekunder.

**P1 — Artwork scanning er synkron per fil:**
Initial scan kører som ét goroutine. Ved 10.000 spor med embedded covers kan det tage 10-30 min. Ingen progress-endpoint eksisterer endnu.

**P1 — Cover thumbnail generation er on-demand:**
Første request til et ukendt cover genererer thumbnail og blokerer. Ved mange samtidige brugere kan dette give burst-latens.

**P2 — SQLite write-lock ved scan + afspilning:**
modernc/sqlite er single-writer. Under scan (INSERT/UPDATE) kan queue-operationer blokere kortvarigt.

### 5.3 Performance testplan

```bash
# Generer testdata (10k spor)
go run ./tools/genseed --tracks=10000  # skal laves

# Benchmark søgning
go test ./internal/api/... -bench=BenchmarkSearch -benchtime=10s

# Load test med hey (installer: go install github.com/rakyll/hey@latest)
hey -n 1000 -c 10 \
  -H "X-Session-Token: $TOKEN" \
  "http://localhost:8080/api/library/search?q=love"

# SSE stress test — 50 samtidige abonnenter
for i in $(seq 1 50); do
  curl -s -N -H "X-Session-Token: $TOKEN" \
    http://localhost:8080/api/events &
done
# Monitor med: watch -n1 "docker stats crownjukebox-backend-1"
```

---

## 6. Robusthed til festbrug — Party Survival Checklist

| Situation | Forventet adfærd | Fallback | Logning | Brugerbesked |
|-----------|-----------------|----------|---------|--------------|
| **Internet ryger** | Alt kører lokalt, ingen ekstern afhængighed | Intet behov — 100% offline | Ingen særlig log nødvendig | Ingen — transparent |
| **Subsonic er nede** | Lokal musik fortsætter. Subsonic-spor kan ikke streames | Returnér HTTP 503 for Subsonic-spor | `[subsonic] unreachable: ...` | "Dette nummer er midlertidigt utilgængeligt" |
| **Musikfil mangler** | Stream-endpoint returnerer 404 | Audio-element `error`-event fyres | `[stream] file not found: path` | "Filen kunne ikke afspilles" — næste sang starter |
| **Cover mangler** | Placeholder PNG serveres | `servePlaceholder()` allerede implementeret | Ingen (forventet) | Placeholder vises automatisk |
| **Browser refresher** | SSE genopretter, afspilningsstatus hentes fra `/api/playback/state` | loadState() fra DB ved startup | Ingen | Ingen — transparent |
| **Backend restarter** | DB persisterer kø og afspilningsstatus. Frontend genopretter SSE | loadState() i playback.NewManager | Startup-log | "Genoprettede forbindelse" |
| **Frontend mister SSE** | Frontend skal re-subscribe automatisk efter X sekunder | Heartbeat ping opdager timeout | Client-side retry-logik | Spinner / "genoprettelse..." |
| **Gæst adgang udløber midt i brug** | SSE-event user_access_expired udsentes → frontend viser besked | Sessions revokeres server-side | `[access] user X expired` | "Din adgang er udløbet" |
| **Admin lukker adgang under kø** | Samme som ovenfor | Brugerens HTTP-requests returnerer 401 | `[admin] user X disabled` | "Du er logget ud af admin" |
| **To brugere vælger samme sang** | Begge tilføjelser accepteres — sangen havner to gange i kø | Ingen deduplication | Ingen | Ingen — retro-korrekt adfærd |
| **SKÅLE trykkes hurtigt gentagne gange** | ⚠️ **RISIKO:** Ingen debounce/cooldown implementeret. Kan starte partysang-kaskade | Bør implementere 30s cooldown | Bør logge `[party] cheers requested by X` | "SKÅL! 🎉" kun én gang |
| **Autoplay finder ikke nummer** | `AutoplayNext()` returnerer error → playback stopper | Logges, IsPlaying sættes false | `[autoplay] no tracks available` | Ingen — kø er bare tom |
| **FLAC kan ikke afspilles** | Browser audio-fejl, `audio.onerror` fyres | `trackEnded` bør kaldes ved fejl også | Bør logge client-side fejl til backend | "Springer over…" → næste sang |
| **Storage fuld** | SQLite-writes fejler, artwork-writes fejler | Backend returnerer 500, log fyres | `[db] SQLITE_FULL` i stderr | Ingen direkte — admin ser fejl i log |

> ⚠️ **KRITISK FUND:** `audio.onerror` er ikke implementeret i `NowPlaying.tsx`.  
> Hvis en FLAC fejler, hænger afspilningen for evigt. Skal rettes.

> ⚠️ **KRITISK FUND:** SKÅLE-knap har ingen cooldown.  
> Under en fest kan én beruset gæst trykke 10 gange og starte 10 party-sange i kø.

---

## 7. Security Hardening

### P0 — Kritisk (bloker release)

| # | Fund | Risiko | Anbefalet fix |
|---|------|--------|---------------|
| S-01 | `ADMIN_PASSWORD=changeme` default i `Dockerfile` og `docker-compose.yml` | Admin-konto kompromitteret ud af boksen | Fjern default, kræv eksplicit sætning i .env. Tilføj startup-check: afvis start hvis password == "changeme" |
| S-02 | `JWT_SECRET` navngivet forkert — det er ikke JWT (det er session-token salt). Misvisende navn → ops kan overse det | Ingen direkte risiko men confusion → manglende rotation | Omdøb til `SECRET_KEY` eller `APP_SECRET` for klarhed |
| S-03 | Ingen rate limiting på `/api/auth/login` og `/api/auth/qr-login` | Brute force PIN (4 cifre = 10.000 kombinationer) | Tilføj chi-middleware: max 5 forsøg per IP per 15 min. Brug en simpel in-memory counter eller redis |
| S-04 | `err.Error()` concateneres direkte i HTTP response i `middleware.go` | Information disclosure — interne fejlbeskeder til klient | Returner generisk fejl til klient, log detaljer server-side |
| S-05 | `Dockerfile` kører `go 1.22` men go.mod kræver `1.26` | Build fejler i CI/CD | Ret til `FROM golang:1.26-alpine AS builder` |

### P1 — Alvorlig (skal rettes inden første rigtige fest)

| # | Fund | Risiko | Anbefalet fix |
|---|------|--------|---------------|
| S-06 | Ingen rate limiting på `/api/party/cheers` | En gæst kan spamme party-knap | Max 1 cheers per user per 30 sekunder |
| S-07 | Session token sendes via query parameter til SSE (`/api/events?token=...`) | Token i server-logs og browser historik | Acceptabel for SSE (EventSource-limitation), men log skal maskere token |
| S-08 | `AllowedOrigins: "*"` default | CORS åben for alle origins | .env.example advarer, men default i config.go bør være `"http://localhost:3000"` ikke `"*"` |
| S-09 | QR-access-link token: ingen begrænsning på antal aktive links per bruger | En admin kan generere ubegrænset mange links | Max 3 aktive links per bruger, eller invalidér forrige ved ny generering |
| S-10 | Subsonic password i miljøvariabel — ender i docker inspect output | Credentials eksponerede for OS-brugere med docker adgang | Acceptabel for lokal installation, men dokumentér truslen |
| S-11 | `/api/library/missing-covers` returnerer full disk paths | Information disclosure | Kræv admin-rolle på dette endpoint |

### P2 — Moderat (nice-to-have til v0.2)

| # | Fund | Risiko | Anbefalet fix |
|---|------|--------|---------------|
| S-12 | Ingen audit log for admin-handlinger | Svær at debugge "hvem gjorde hvad" | Log admin-handlinger til separat tabel eller struktureret log |
| S-13 | Ingen CSRF-beskyttelse | Session er header-baseret (X-Session-Token), ikke cookies → CSRF ikke relevant | Dokumentér dette eksplicit |
| S-14 | `admin_password` i log ved startup-fejl? | Skal bekræftes — kig på seedAdmin() | Brug `log.Printf("[seed] admin seeded: %s", username)` uden password |
| S-15 | Backup af DB indeholder bcrypt hashes | Risiko ved databaselæk | Dokumentér at DB er følsom, anbefal encrypted backup |

---

## 8. Observability og fejlfinding

### 8.1 Mangler der bør implementeres

**Struktureret logging (P1):**
```go
// I dag: log.Printf("[scan] found %d tracks", n)
// Bedre: slog (standard library i Go 1.21+)
slog.Info("scan complete",
    "tracks", n,
    "duration_ms", elapsed.Milliseconds(),
    "dir", cfg.MusicDir,
)
```

**Log levels:**
- `DEBUG`: SQL queries, SSE connect/disconnect
- `INFO`: Scan start/stop, user login/logout, party events
- `WARN`: Cover art missing, Subsonic unreachable
- `ERROR`: DB write failure, file not found, scan errors

### 8.2 Anbefalede endpoints

**`GET /healthz`** — liveness probe (skal altid returnere 200 hvis processen kører):
```json
{ "status": "ok", "version": "0.1.0" }
```

**`GET /readyz`** — readiness probe (returnerer 503 hvis DB ikke er tilgængelig):
```json
{ "status": "ready", "db": "ok", "library_tracks": 1234 }
```

**`GET /api/playback/state`** — bruges allerede som healthcheck i Docker. ⚠️ Kræver session-token. Bør erstattes med `/healthz` i Docker healthcheck.

**`GET /api/admin/diagnostics`** (admin-only):
```json
{
  "version": "0.1.0",
  "uptime_seconds": 3600,
  "db_size_bytes": 1048576,
  "library": {
    "artists": 45,
    "albums": 120,
    "tracks": 1456,
    "last_scan": "2026-04-25T14:00:00Z"
  },
  "artwork_cache": {
    "size_bytes": 52428800,
    "missing_covers": 3
  },
  "queue_length": 5,
  "sse_clients": 4,
  "active_users": 8
}
```

**`GET /metrics`** (valgfrit, Prometheus-format):
```
crownjukebox_tracks_total 1456
crownjukebox_queue_length 5
crownjukebox_sse_clients 4
crownjukebox_scan_duration_seconds 45.2
crownjukebox_cover_cache_hits_total 1234
crownjukebox_cover_cache_misses_total 12
```

> ⚠️ **FUND:** Nuværende Docker healthcheck bruger `/api/playback/state` som kræver auth.  
> Bør ændres til `/healthz` (ingen auth) så Docker kan tjekke uden credentials.

---

## 9. Backup og Restore

### 9.1 Hvad skal backes op

| Data | Placering | Kan genskabes? | Prioritet |
|------|-----------|----------------|-----------|
| SQLite database | `/data/crownjukebox.db` | Nej (brugere, sessions, kø, historik) | **Kritisk** |
| Musikfiler | Host-sti monteret som `/music` | Fra original kilde | Brugers ansvar |
| Artwork cache | `/artwork_cache` | **Ja** — kan regenereres ved scan | Lav |
| `.env` config | Host-maskine | Nej (passwords, secrets) | **Kritisk** |
| `docker-compose.yml` | Host-maskine | Fra repo | Lav |

### 9.2 Backup-kommandoer

```bash
# SQLite hot backup (sikkert under drift takket være WAL mode)
docker compose exec backend sqlite3 /data/crownjukebox.db \
  ".backup /data/crownjukebox-$(date +%Y%m%d-%H%M%S).db.bak"

# Eller kopier volume direkte (stop service for konsistens)
docker compose stop backend
docker run --rm \
  -v crownjukebox_db_data:/data \
  -v $(pwd)/backups:/backups \
  alpine tar czf /backups/db-$(date +%Y%m%d).tar.gz -C /data .
docker compose start backend

# Config backup
cp .env backups/.env.$(date +%Y%m%d)
```

### 9.3 Restore-kommandoer

```bash
# Stop backend
docker compose stop backend

# Restore DB fra backup
docker run --rm \
  -v crownjukebox_db_data:/data \
  -v $(pwd)/backups:/backups \
  alpine sh -c "cp /backups/crownjukebox-20260425.db.bak /data/crownjukebox.db"

# Start igen
docker compose start backend
```

### 9.4 Flyt til ny server

```bash
# 1. Backup DB og .env på gammel server (se ovenfor)
# 2. På ny server:
git clone https://github.com/crownjukebox/crownjukebox.git
cd crownjukebox
cp /path/to/.env.backup .env
# 3. Opret volumes og restore DB
docker compose up -d --no-start
docker run --rm \
  -v crownjukebox_db_data:/data \
  -v /path/to/backup:/backup \
  alpine cp /backup/crownjukebox.db.bak /data/crownjukebox.db
# 4. Start
docker compose up -d
```

### 9.5 Opdater container images uden datatab

```bash
# Volumes overlever image-opdatering automatisk
docker compose pull           # hent nye images
docker compose up -d          # genstarter kun ændrede containere
# Data i db_data og artwork_cache volumes er intakt
```

---

## 10. Release Checklist — v0.1.0

### Build

- [ ] `go mod tidy` kører uden fejl
- [ ] `go vet ./...` rapporterer ingen problemer
- [ ] `go test ./...` — alle tests grønne (kræver tests fra afsnit 3)
- [ ] `npx tsc --noEmit` — ingen TypeScript-fejl
- [ ] `npm run lint` — ingen ESLint-fejl
- [ ] `npm run build` — dist/ bygges korrekt
- [ ] `docker compose build --no-cache` — begge images bygges
- [ ] Backend healthcheck = healthy efter `docker compose up`
- [ ] ⚠️ Ret Dockerfile til `golang:1.26-alpine` inden release

### Tests

- [ ] Go integration tests dækker auth, queue, playback, party
- [ ] Playwright smoke test gennemført (alle A/G/M/P/U/D test-IDs grønne)
- [ ] Performance test: søgning < 200 ms på testbibliotek
- [ ] Sikkerhedscheck: S-01 til S-04 rettet

### Docker images

- [ ] `docker buildx build --platform linux/amd64,linux/arm64` — begge arkitekturer bygger
- [ ] Image pushes til `ghcr.io/kronborgs/crownjukebox-backend:v0.1.0`
- [ ] Image pushes til `ghcr.io/kronborgs/crownjukebox-frontend:v0.1.0`
- [ ] `:latest` tags opdateres

### Portainer / Unraid

- [ ] `portainer-stack.yml` bruger `ghcr.io/...` image-referencer med versionstag
- [ ] `unraid-template.xml` og `unraid-template-backend.xml` opdateret med v0.1.0
- [ ] Testet: import i Portainer → Stack → Web editor kører korrekt
- [ ] Testet: Unraid CA import virker

### Dokumentation

- [ ] `.env.example` er komplet og ajour
- [ ] `README.md` er opdateret med korrekte image-navne og versioner
- [ ] `CHANGELOG.md` oprettet med v0.1.0 ændringer
- [ ] `KNOWN_ISSUES.md` oprettet (se afsnit 12)
- [ ] Backup-instruktioner dokumenteret
- [ ] First-run guide skrevet

### Funktionel smoke test

- [ ] Admin login virker
- [ ] Opret gæstebruger med QR virker
- [ ] Scan musikbibliotek virker
- [ ] Tilføj sang til kø virker
- [ ] Afspilning starter automatisk
- [ ] SKÅLE-knap virker med konfetti
- [ ] Cover art vises korrekt
- [ ] SSE-events modtages i realtid
- [ ] Docker restart mister ikke data

---

## 11. Dokumentationsstruktur

```
docs/
  README.md             — Overblik, features, quick start, arkitektur
  INSTALL.md            — Fuld installationsguide (bare-metal + Docker)
  UNRAID.md             — Specifik guide til Unraid CA-template import
  PORTAINER.md          — Guide til Portainer stack-deploy
  CONFIGURATION.md      — Alle miljøvariabler med værdier og eksempler
  ADMIN_GUIDE.md        — Brugerstyring, QR-login, scanning, SKÅLE-opsætning
  GUEST_GUIDE.md        — Kort guide til gæster (kan printes til festen)
  TROUBLESHOOTING.md    — Hyppige fejl og løsninger
  DEVELOPMENT.md        — Opsætning af dev-miljø, tests, commit-konventioner
  API.md                — REST API-dokumentation (alle endpoints)
  SECURITY.md           — Trusselmodel, hardening-anbefalinger
  BACKUP_RESTORE.md     — Trin-for-trin backup og restore
  CHANGELOG.md          — Versionshistorik
```

| Fil | Indhold |
|-----|---------|
| `README.md` | Features-liste, arkitekturdiagram, quick start (5 linjer), links til docs/ |
| `INSTALL.md` | Krav (Docker 24+, 2 GB RAM, 10 GB disk), trin-for-trin med .env-vejledning |
| `UNRAID.md` | Download XML, Community Applications, template-felter forklaret |
| `PORTAINER.md` | Stacks → Web editor, indsæt portainer-stack.yml, udfyld env-felter |
| `CONFIGURATION.md` | Tabel over alle env-vars, standardværdier, eksempler, sikkerhedsnoter |
| `ADMIN_GUIDE.md` | Første login, oprette brugere, QR-generering, scan, SKÅLE-playliste, tastatur-bindings |
| `GUEST_GUIDE.md` | Scan QR, søg sang, tilføj til kø, hvad SKÅLE gør — A4 printvenlig |
| `TROUBLESHOOTING.md` | Covers vises ikke / Scan finder ingen sange / QR virker ikke / Container starter ikke |
| `DEVELOPMENT.md` | go run, vite dev, pre-commit hooks, test-kommandoer, GitHub Actions |
| `API.md` | Alle endpoints med request/response-eksempler, auth-krav, permission-krav |
| `SECURITY.md` | Session-model, token-hashing, CORS-opsætning, LAN-trusselmodel |
| `BACKUP_RESTORE.md` | Daglig backup-cron, restore-procedure, flyt til ny server |

---

## 12. Endelig Vurdering

### Er projektet klar til testfest?

**Næsten — men 3 blokerere skal rettes inden:**

1. **`audio.onerror` ikke håndteret** — kan forårsage fastfryst afspilning ved korrupt fil (P0)
2. **Ingen SKÅLE-cooldown** — gæster kan spamme party-knappen (P0 til fest)
3. **Dockerfile `golang:1.22` vs `go.mod 1.26`** — Docker build fejler muligvis (P0 build)

De resterende fund er P1/P2 og er acceptable til en **første testfest** — men bør rettes inden officiel v0.1.0.

---

### Hvad mangler til v0.1.0?

| # | Opgave | Prioritet |
|---|--------|-----------|
| 1 | Ret Dockerfile: `golang:1.26-alpine` | P0 |
| 2 | Implementér `audio.onerror` → kald `trackEnded` og vis besked | P0 |
| 3 | SKÅLE cooldown: 30 sekunder per bruger server-side | P0 |
| 4 | `/healthz` endpoint uden auth til Docker healthcheck | P1 |
| 5 | Rate limiting på login-endpoint (max 5/15min per IP) | P1 |
| 6 | SQLite indekser verificeret i migration | P1 |
| 7 | SSE frontend auto-reconnect logik | P1 |
| 8 | Startup-advarsel hvis `ADMIN_PASSWORD=changeme` | P1 |
| 9 | Go integration tests (minimum auth + queue + playback) | P1 |
| 10 | CHANGELOG.md og KNOWN_ISSUES.md | P2 |

---

### De 10 vigtigste ting at teste på rigtig hardware

| # | Test | Hvorfor |
|---|------|---------|
| 1 | **Raspberry Pi 4/5 arm64** — start container, afspil FLAC | Vigtigste deployment-target. arm64 binary + FLAC-decoding i browser |
| 2 | **Scan 500+ rigtige musikfiler** | Metadata-quirks, filnavne med unicode, korrupte tags |
| 3 | **Wifi-mobil login via QR** | Real-world netværkslatens, cross-origin, iOS Safari kræsne |
| 4 | **10+ samtidige SSE-klienter** | Fest-scenario: alle har telefonen åben |
| 5 | **SKÅLE under aktiv afspilning** | Party-engine + playback state race condition |
| 6 | **Kø-tilføjelse fra 3 brugere samtidig** | SQLite write-lock, position-beregning |
| 7 | **Browser autoplay policy** — frisk iOS Safari | NotAllowedError-overlay skal fungere på rigtig enhed |
| 8 | **Container restart midt i afspilning** | loadState() skal genoprette korrekt |
| 9 | **4K TV som kiosk-skærm** | Layout ved 3840×2160, font-størrelser, touch-target størrelse |
| 10 | **6+ timers drift uden restart** | Memory leaks, SSE-connection akkumulering, DB-fil vækst |

---

### Anbefalet rækkefølge

```
Uge 1 — Blokerere og kritisk hardening
  1. Ret Dockerfile golang-version
  2. Implementér audio.onerror + trackEnded-fallback
  3. SKÅLE cooldown (30s)
  4. /healthz endpoint
  5. Rate limiting på login

Uge 2 — Testinfrastruktur
  6. SQLite indekser bekræftet
  7. Go integration tests (auth, queue, playback)
  8. SSE frontend auto-reconnect
  9. Startup-advarsel ved default password

Uge 3 — Testfest (lille, kontrolleret)
  10. Deploy på Raspberry Pi 5
  11. 5-10 gæster, rigtig musik
  12. Logfil-gennemgang dagen efter

Uge 4 — v0.1.0 release
  13. Playwright smoke tests
  14. Dokumentation færdig
  15. Multi-arch Docker push
  16. GitHub Release med CHANGELOG
```

---

*Dokumentet dækker kodebase-status per April 2026 og er baseret på gennemgang af alle backend/frontend kildefiler.*
