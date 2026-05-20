# 🎵 Intelligent Autoplay Implementation Plan

## Executive Summary

Dette dokument beskriver implementeringen af intelligent autoplay og Skål-overlay funktionalitet til CrownJukebox. 

**Vigtigste princip:** Minimal ændring af eksisterende kode. Bevar al funktionalitet.

---

## 📊 EKSISTERENDE ARKITEKTUR (Bevares)

### Kø-system
- `queue/manager.go` — AddTrack(), Advance(), Reorder()
- `QueueItem.IsAutoplay bool` — marker autoplay-tracks
- Room-baseret kø-isolation (hver bruger = én room)

### Playback
- `playback/state.go` — Play(), Pause(), Skip(), TrackEnded()
- Gemmer current track, position, is_playing per room
- History tracking i `playback_history` tabel

### Party/Skål
- `party/engine.go` — TriggerCheers(), BuildSequence()
- `playback.StartParty()` — gemmer state, spiller party tracks, restorer

### Eksisterende flow:
```
User adds track → AddTrack(trackID, userID, is_autoplay=false)
                → Queue ikke tom

Play() kaldt    → Advance() henter næste fra queue
                → Hvis queue tom + autoplay_enabled=true
                   → AutoplayNext() vælger random track fra recent genres
                   → Play med is_autoplay_track=true

TrackEnded()    → Play() igen (loop)
```

---

## 🎯 NYE KRAV

### 1. Source Tracking
- **Problem:** Ingen måde at vide om history-entry er fra USER eller AUTOPLAY
- **Løsning:** Tilføj `source` kolonne til `playback_history`
- **Brug:** Kun USER-source bruges til genre-score beregning

### 2. Intelligent Genre Selection
- **Problem:** Nuværende: tilfældig genre fra sidste 60 min
- **Løsning:** Tidsvægtet score system
  - Sidste 2 timer: vægt 5
  - Sidste 24 timer: vægt 2
  - Sidste 30 dage: vægt 1
- **Formel:**
  ```
  genre_score = (plays_2h * 5) + (plays_24h * 2) + (plays_30d * 1)
  ```

### 3. Anti-Repetition Rules
- **Track:** Ikke samme sang inden for 6 timer
- **Artist:** Ikke samme kunstner inden for 30 minutter  
- **Genre:** Max 2 på række fra samme genre

### 4. Skål Overlay på User Tracks
- **Problem:** Skål stopper altid playback og restorer
- **Ønsket:** Skål overlay hvis USER track spiller
- **Løsning:** Check `is_autoplay_track` før StartParty()

---

## 🔧 IMPLEMENTERING

### FASE 1: Database Migration

**Fil:** `backend/internal/db/migrations/007_autoplay_improvements.sql`

```sql
-- Add source tracking for USER vs AUTOPLAY history
ALTER TABLE playback_history ADD COLUMN source TEXT NOT NULL DEFAULT 'USER';

-- Denormalize genre and artist for fast anti-repetition queries
ALTER TABLE playback_history ADD COLUMN genre TEXT NOT NULL DEFAULT '';
ALTER TABLE playback_history ADD COLUMN artist TEXT NOT NULL DEFAULT '';

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_history_source_started 
  ON playback_history(source, started_at);
CREATE INDEX IF NOT EXISTS idx_history_room_started 
  ON playback_history(room_id, started_at);
CREATE INDEX IF NOT EXISTS idx_history_room_genre_started 
  ON playback_history(room_id, genre, started_at);
CREATE INDEX IF NOT EXISTS idx_history_room_artist_started 
  ON playback_history(room_id, artist, started_at);

-- Backfill existing records as USER (safe — old history was pre-autoplay)
UPDATE playback_history SET source = 'USER' WHERE source = '';

-- Backfill genre/artist from tracks/albums/artists
UPDATE playback_history
SET 
    genre = (
        SELECT COALESCE(al.genre, '') 
        FROM tracks t 
        JOIN albums al ON al.id = t.album_id 
        WHERE t.id = playback_history.track_id
    ),
    artist = (
        SELECT COALESCE(ar.name, '') 
        FROM tracks t 
        JOIN artists ar ON ar.id = t.artist_id 
        WHERE t.id = playback_history.track_id
    )
WHERE genre = '' OR artist = '';
```

**Opdater:** `backend/internal/db/models.go`

```go
type PlaybackHistory struct {
	ID           string     `db:"id"`
	RoomID       string     `db:"room_id"`
	TrackID      string     `db:"track_id"`
	PlayedByUser string     `db:"played_by_user_id"`
	StartedAt    time.Time  `db:"started_at"`
	EndedAt      *time.Time `db:"ended_at"`
	WasSkipped   bool       `db:"was_skipped"`
	WasParty     bool       `db:"was_party"`
	Source       string     `db:"source"`  // NEW: "USER" | "AUTOPLAY"
	Genre        string     `db:"genre"`   // NEW: denormalized
	Artist       string     `db:"artist"`  // NEW: denormalized
}
```

---

### FASE 2: Intelligent AutoplayNext

**Fil:** `backend/internal/queue/manager.go`

**Strategi:**
1. Beregn genre-scores fra USER history med tidsvægtning
2. Weighted random selection af genre
3. Vælg track fra genre med anti-repetition checks
4. Fallback til random hvis ingen match

**Ny funktion:** `calculateGenreScores()`

```go
// GenreScore holds weighted popularity for a genre
type GenreScore struct {
	Genre string
	Score float64
}

// calculateGenreScores beregner genre-popularitet baseret på USER-valg
// med tidsvægtning: 2h=vægt 5, 24h=vægt 2, 30d=vægt 1
func (m *Manager) calculateGenreScores(ctx context.Context) ([]GenreScore, error) {
	type genreCount struct {
		Genre string `db:"genre"`
		Count int    `db:"count"`
	}

	// Last 2 hours (weight 5)
	var last2h []genreCount
	_ = m.db.SelectContext(ctx, &last2h, `
		SELECT genre, COUNT(*) as count
		FROM playback_history
		WHERE room_id = ?
		  AND source = 'USER'
		  AND genre != ''
		  AND started_at > datetime('now', '-2 hours')
		GROUP BY genre`, m.roomID)

	// Last 24 hours (weight 2)
	var last24h []genreCount
	_ = m.db.SelectContext(ctx, &last24h, `
		SELECT genre, COUNT(*) as count
		FROM playback_history
		WHERE room_id = ?
		  AND source = 'USER'
		  AND genre != ''
		  AND started_at > datetime('now', '-24 hours')
		  AND started_at <= datetime('now', '-2 hours')
		GROUP BY genre`, m.roomID)

	// Last 30 days (weight 1)
	var last30d []genreCount
	_ = m.db.SelectContext(ctx, &last30d, `
		SELECT genre, COUNT(*) as count
		FROM playback_history
		WHERE room_id = ?
		  AND source = 'USER'
		  AND genre != ''
		  AND started_at > datetime('now', '-30 days')
		  AND started_at <= datetime('now', '-24 hours')
		GROUP BY genre`, m.roomID)

	// Aggregate scores
	scoreMap := make(map[string]float64)
	for _, g := range last2h {
		scoreMap[g.Genre] += float64(g.Count) * 5.0
	}
	for _, g := range last24h {
		scoreMap[g.Genre] += float64(g.Count) * 2.0
	}
	for _, g := range last30d {
		scoreMap[g.Genre] += float64(g.Count) * 1.0
	}

	// Convert to sorted slice
	scores := make([]GenreScore, 0, len(scoreMap))
	for genre, score := range scoreMap {
		scores = append(scores, GenreScore{Genre: genre, Score: score})
	}

	// Sort by score descending
	sort.Slice(scores, func(i, j int) bool {
		return scores[i].Score > scores[j].Score
	})

	return scores, nil
}
```

**Ny funktion:** `selectWeightedGenre()`

```go
// selectWeightedGenre vælger genre med weighted random
// 70% baseret på user preferences, 20% popular, 10% random
func (m *Manager) selectWeightedGenre(ctx context.Context, scores []GenreScore) (string, error) {
	if len(scores) == 0 {
		// No user history — pick any genre from library
		var genre string
		err := m.db.GetContext(ctx, &genre, `
			SELECT DISTINCT genre FROM albums 
			WHERE genre != '' 
			ORDER BY RANDOM() LIMIT 1`)
		return genre, err
	}

	// Weighted random: 70% from top genres, 20% from mid-tier, 10% random
	roll := rand.Float64()

	if roll < 0.7 {
		// Top weighted genres
		totalScore := 0.0
		for _, s := range scores {
			totalScore += s.Score
		}
		if totalScore == 0 {
			return scores[0].Genre, nil
		}

		target := rand.Float64() * totalScore
		cumulative := 0.0
		for _, s := range scores {
			cumulative += s.Score
			if cumulative >= target {
				return s.Genre, nil
			}
		}
		return scores[0].Genre, nil
	}

	if roll < 0.9 {
		// Mid-tier: pick from middle of sorted list
		mid := len(scores) / 2
		if mid < len(scores) {
			return scores[mid].Genre, nil
		}
		return scores[0].Genre, nil
	}

	// 10% random discovery
	var genre string
	err := m.db.GetContext(ctx, &genre, `
		SELECT DISTINCT genre FROM albums 
		WHERE genre != '' 
		ORDER BY RANDOM() LIMIT 1`)
	if err != nil {
		// Fallback to first score genre
		return scores[0].Genre, nil
	}
	return genre, nil
}
```

**Opdater:** `AutoplayNext()` — fuld implementation

```go
// AutoplayNext selects a track for autoplay using intelligent genre scoring.
// Prioritet: 70% user-preferred genres, 20% popular tracks, 10% discovery.
// Anti-repetition: track (6h), artist (30min), genre (max 2 i træk).
func (m *Manager) AutoplayNext(ctx context.Context) (*db.Track, error) {
	// Calculate genre scores from USER history only
	scores, err := m.calculateGenreScores(ctx)
	if err != nil {
		return nil, fmt.Errorf("genre score calculation failed: %w", err)
	}

	// Get recently played tracks (last 6 hours) to avoid repetition
	var recentTrackIDs []string
	_ = m.db.SelectContext(ctx, &recentTrackIDs, `
		SELECT track_id FROM playback_history
		WHERE room_id = ? AND started_at > datetime('now', '-6 hours')`, m.roomID)

	// Get recently played artists (last 30 minutes) to avoid repetition
	var recentArtists []string
	_ = m.db.SelectContext(ctx, &recentArtists, `
		SELECT DISTINCT artist FROM playback_history
		WHERE room_id = ? 
		  AND artist != ''
		  AND started_at > datetime('now', '-30 minutes')`, m.roomID)

	// Get last 2 genres played to avoid playing same genre 3 times in a row
	var lastGenres []string
	_ = m.db.SelectContext(ctx, &lastGenres, `
		SELECT genre FROM playback_history
		WHERE room_id = ? AND genre != ''
		ORDER BY started_at DESC LIMIT 2`, m.roomID)

	// Select genre with weighted randomrepeatedGenre := ""
	if len(lastGenres) == 2 && lastGenres[0] == lastGenres[1] {
		repeatedGenre = lastGenres[0] // Avoid this genre
	}

	selectedGenre, err := m.selectWeightedGenre(ctx, scores)
	if err != nil || selectedGenre == "" {
		// Fallback: any random track
		return m.fallbackRandomTrack(ctx, recentTrackIDs)
	}

	// If selected genre was just played twice, pick next best genre
	if selectedGenre == repeatedGenre && len(scores) > 1 {
		for _, s := range scores {
			if s.Genre != repeatedGenre {
				selectedGenre = s.Genre
				break
			}
		}
	}

	// Query tracks from selected genre with anti-repetition filters
	var track db.Track
	var query string
	var args []interface{}

	if len(recentTrackIDs) > 0 && len(recentArtists) > 0 {
		// Exclude recent tracks AND recent artists
		query, args, _ = sqlx.In(`
			SELECT t.* 
			FROM tracks t
			JOIN albums al ON al.id = t.album_id
			JOIN artists ar ON ar.id = t.artist_id
			WHERE al.genre = ? 
			  AND t.id NOT IN (?)
			  AND ar.name NOT IN (?)
			ORDER BY RANDOM() LIMIT 1`, selectedGenre, recentTrackIDs, recentArtists)
		query = m.db.Rebind(query)
		if err := m.db.GetContext(ctx, &track, query, args...); err == nil {
			return &track, nil
		}
	} else if len(recentTrackIDs) > 0 {
		// Exclude recent tracks only
		query, args, _ = sqlx.In(`
			SELECT t.* 
			FROM tracks t
			JOIN albums al ON al.id = t.album_id
			WHERE al.genre = ? AND t.id NOT IN (?)
			ORDER BY RANDOM() LIMIT 1`, selectedGenre, recentTrackIDs)
		query = m.db.Rebind(query)
		if err := m.db.GetContext(ctx, &track, query, args...); err == nil {
			return &track, nil
		}
	} else {
		// No recent plays — any track from genre
		if err := m.db.GetContext(ctx, &track, `
			SELECT t.* 
			FROM tracks t
			JOIN albums al ON al.id = t.album_id
			WHERE al.genre = ?
			ORDER BY RANDOM() LIMIT 1`, selectedGenre); err == nil {
			return &track, nil
		}
	}

	// Fallback: genre had no valid tracks — pick any random track
	return m.fallbackRandomTrack(ctx, recentTrackIDs)
}

// fallbackRandomTrack picks any random track avoiding recent plays
func (m *Manager) fallbackRandomTrack(ctx context.Context, recentTrackIDs []string) (*db.Track, error) {
	var track db.Track

	if len(recentTrackIDs) > 0 {
		query, args, _ := sqlx.In(`SELECT * FROM tracks WHERE id NOT IN (?) ORDER BY RANDOM() LIMIT 1`, recentTrackIDs)
		query = m.db.Rebind(query)
		if err := m.db.GetContext(ctx, &track, query, args...); err == nil {
			return &track, nil
		}
	}

	// Absolute fallback: any track
	if err := m.db.GetContext(ctx, &track, `SELECT * FROM tracks ORDER BY RANDOM() LIMIT 1`); err != nil {
		return nil, fmt.Errorf("no tracks in library")
	}
	return &track, nil
}
```

---

### FASE 3: Source Tracking i Playback

**Opdater:** `backend/internal/playback/state.go` — `Play()` funktion

**Ændring:** Når history entry oprettes, gem source + genre + artist

```go
// I Play() funktionen, omkring linje 235, erstat:

// Start new history entry
m.historyID = uuid.NewString()
_, _ = m.db.ExecContext(ctx, `
	INSERT INTO playback_history (id, room_id, track_id, played_by_user_id, started_at)
	VALUES (?, ?, ?, ?, ?)`,
	m.historyID, m.roomID, trackID, userID, time.Now(),
)

// MED:

// Start new history entry with source tracking
m.historyID = uuid.NewString()
source := "USER"
if nextIsAutoplay {
	source = "AUTOPLAY"
}

// Fetch genre and artist for denormalization
var genre, artist string
_ = m.db.GetContext(ctx, &genre, `
	SELECT COALESCE(al.genre, '') 
	FROM tracks t 
	JOIN albums al ON al.id = t.album_id 
	WHERE t.id = ?`, trackID)
_ = m.db.GetContext(ctx, &artist, `
	SELECT COALESCE(ar.name, '') 
	FROM tracks t 
	JOIN artists ar ON ar.id = t.artist_id 
	WHERE t.id = ?`, trackID)

_, _ = m.db.ExecContext(ctx, `
	INSERT INTO playback_history 
		(id, room_id, track_id, played_by_user_id, started_at, source, genre, artist)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	m.historyID, m.roomID, trackID, userID, time.Now(), source, genre, artist,
)
```

**Vigtigt:** Også opdater party history tracking (søg efter "was_party"):

```go
// Når party tracks gemmes, brug source="USER" (party tæller som user-valgt event)
// Find UpdatedAt time.Now() linjer i StartParty og sæt source="USER" i INSERT
```

---

### FASE 4: Skål Overlay på User Tracks

**Problem:** Nuværende StartParty() gemmer altid state og restorer. User ønsker overlay når USER track spiller.

**Løsning:** Tjek `is_autoplay_track` før StartParty. Hvis USER track, spil Skål som overlay (via fade eller parallel afspilning).

**Opdater:** `backend/internal/api/server.go` — `handleParty()` funktion

Find handleParty (søg efter "TriggerCheers"):

```go
func (s *Server) handleParty(w http.ResponseWriter, r *http.Request) {
	sd, _ := auth.GetSessionFromContext(r.Context())
	userID := ""
	if sd != nil {
		userID = sd.User.ID
	}

	rm := getRoomFromCtx(r.Context())

	// NEW: Check if autoplay is playing — only interrupt autoplay, not user tracks
	state, _ := rm.Playback.GetState(r.Context())
	
	// If USER track is playing, send party overlay event (frontend handles)
	if state != nil && state.IsPlaying && !state.IsAutoplayTrack && state.CurrentTrack != nil {
		// Build party sequence for overlay
		seq, err := rm.Party.BuildSequence(r.Context())
		if err != nil {
			jsonError(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Build cover URL for first track
		coverURL := ""
		if seq.Tracks[0].CoverArtID != nil && *seq.Tracks[0].CoverArtID != "" {
			coverURL = "/api/library/cover/" + *seq.Tracks[0].CoverArtID + "?size=large"
		}

		// Broadcast party_overlay event (frontend will play sound effect without stopping music)
		s.hub.BroadcastToRoom(rm.Info.ID, events.EventPartyOverlay, map[string]any{
			"track":        seq.Tracks[0],
			"cover_url":    coverURL,
			"triggered_by": userID,
			"volume_boost": 0, // No boost for overlay
			"track_count":  len(seq.Tracks),
		})

		jsonOK(w, map[string]any{
			"status":      "overlay",
			"track_count": len(seq.Tracks),
			"volume_boost": 0,
		})
		return
	}

	// AUTOPLAY or nothing playing — use normal StartParty (interrupts and restores)
	seq, err := rm.Party.TriggerCheers(r.Context(), userID)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := rm.Playback.StartParty(r.Context(), seq.Tracks, userID); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"status":       "started",
		"track_count":  len(seq.Tracks),
		"volume_boost": seq.VolumeBoost,
	})
}
```

**Opdater:** `backend/internal/events/sse.go` — tilføj EventPartyOverlay konstant

```go
const (
	// ... existing events
	EventPartyStarted          = "party_started"
	EventPartyOverlay          = "party_overlay"  // NEW
	EventPartyEnded            = "party_ended"
	// ...
)
```

---

### FASE 5: Frontend — Party Overlay

**Opdater:** `frontend/src/hooks/usePlayback.ts`

Tilføj listener for `party_overlay` event:

```typescript
// I usePlayback hook, tilføj efter party_started listener:

useSSE('party_overlay', (data: any) => {
	// Play party sound as overlay (short volume boost or sound effect)
	// Don't stop current track
	console.log('[party] overlay triggered', data);
	
	// Show brief visual overlay (eksisterende PartyOverlay kan genbruges)
	// Men sæt en flag så den ikke stopper musik
	
	// Eventuelt: spil kort lyd-effekt via separat Audio element
	const sfx = new Audio('/api/stream/' + data.track.id);
	sfx.volume = 0.3; // Lavere volume så det ikke overdøver musik
	sfx.play().catch(err => console.warn('[party] overlay play failed', err));
});
```

**Alternativt:** Hvis I vil have fuld Skål-sequence som overlay, kan I:
1. Vise PartyOverlay UI
2. Ikke pause `<audio>` elementet
3. Fade musikken lidt ned (volume *= 0.6)
4. Spil Skål-lyd i separat Audio element
5. Når Skål er færdig, fade musik op igen

---

## 🧪 TESTPLAN

### Test 1: Autoplay Genre Intelligence
1. Spil 5 rock sange som USER
2. Lad autoplay køre
3. **Forventet:** Autoplay vælger primært rock (70% chance)

### Test 2: Source Tracking
1. Tilføj sang til kø → spil den
2. Check `playback_history` — `source` skal være `'USER'`
3. Lad autoplay vælge næste
4. Check `playback_history` — `source` skal være `'AUTOPLAY'`

### Test 3: Anti-Repetition (Track)
1. Spil sang X
2. Lad autoplay køre i 5 timer
3. **Forventet:** Sang X spilles ikke igen inden 6 timer

### Test 4: Anti-Repetition (Artist)
1. Spil Beatles sang
2. Lad autoplay vælge næste
3. **Forventet:** Næste sang er IKKE Beatles (inden for 30 min)

### Test 5: Anti-Repetition (Genre)
1. Autoplay spiller 2 rock sange i træk
2. **Forventet:** 3. sang er IKKE rock

### Test 6: Skål Overlay på User Track
1. Tilføj og spil en USER sang
2. Tryk Skål-knap
3. **Forventet:** 
   - USER sang fortsætter (ikke stoppes)
   - Skål-lyd spilles som overlay
   - Efter Skål: USER sang fortsætter

### Test 7: Skål Interrupt på Autoplay
1. Lad autoplay spille
2. Tryk Skål-knap
3. **Forventet:**
   - Autoplay stoppes/fades ud
   - Skål spilles
   - Efter Skål: autoplay fortsætter (hvis queue tom)

### Test 8: User Adds Track During Autoplay
1. Lad autoplay spille
2. Tilføj USER sang til kø
3. **Forventet:**
   - Autoplay stoppes
   - USER sang starter

### Test 9: Empty Library Fallback
1. Slet al history (simuler ny bruger)
2. Enable autoplay
3. **Forventet:** Autoplay vælger random sang (ikke crash)

### Test 10: Backwards Compatibility
1. Disable `autoplay_enabled` setting
2. Lad queue blive tom
3. **Forventet:** Playback stopper (som før)

---

## 📁 FILER DER ÆNDRES

### Backend
- ✅ `backend/internal/db/migrations/007_autoplay_improvements.sql` (NY)
- ✅ `backend/internal/db/models.go` (opdater PlaybackHistory struct)
- ✅ `backend/internal/queue/manager.go` (erstat AutoplayNext + nye funktioner)
- ✅ `backend/internal/playback/state.go` (opdater Play() — source tracking)
- ✅ `backend/internal/api/server.go` (opdater handleParty — overlay check)
- ✅ `backend/internal/events/sse.go` (tilføj EventPartyOverlay konstant)

### Frontend
- ✅ `frontend/src/hooks/usePlayback.ts` (tilføj party_overlay listener)

**TOTAL: 7 filer ændres/tilføjes**

---

## ⚠️ RISIKOFAKTORER & MITIGATIONS

### Risiko 1: Genre-score queries er langsomme
- **Mitigation:** Indexes på `(source, started_at)`, `(room_id, started_at)`
- **Fallback:** Hvis query > 500ms, skip score calculation og brug random

### Risiko 2: Backfill af genre/artist fejler for nogle tracks
- **Mitigation:** DEFAULT `''` — queries filtrerer `!= ''`
- **Impact:** Minimalt — tracks uden genre ignoreres i autoplay

### Risiko 3: Party overlay spiller ikke lyd i nogen browsere (autoplay policy)
- **Mitigation:** User interaction (Skål-knap tryk) tillader Audio.play()
- **Fallback:** Vis kun visual overlay hvis play() fejler

### Risiko 4: Gammel frontend (ikke updated) modtager party_overlay event
- **Mitigation:** Frontend ignorer ukendte events per default (SSE best practice)
- **Impact:** Ingen — event droppes stille

### Risiko 5: Migration 007 fejler midtvejs
- **Mitigation:** SQLite transaktioner — alt eller intet
- **Rollback:** Drop migration 007, kør backend med gammel kode

---

## 🚀 DEPLOYMENT STRATEGI

### Fase A: Database (Zero Downtime)
1. Kør migration 007
2. Backfill kører (kan tage tid på store libraries)
3. **Gammel kode virker stadig** (ignorer nye kolonner)

### Fase B: Backend Deploy
1. Build ny backend
2. Deploy (erstatter gammel binary)
3. Restart service
4. **Frontend virker stadig** (ingen breaking changes)

### Fase C: Frontend Deploy
1. Build ny frontend
2. Deploy (erstatter static files)
3. **Ny party_overlay feature aktiv**

### Rollback Plan
1. Stop backend
2. Deploy gammel backend binary
3. **MIGRATION 007 FORBLIVER** (nye kolonner ignoreres)
4. Alternativt: `DROP` de 3 nye kolonner manuelt

---

## ✅ SUCCESS CRITERIA

- ✅ Autoplay vælger intelligente tracks baseret på USER historie
- ✅ Autoplay undgår repetition (track 6h, artist 30min, genre 2x)
- ✅ Skål overlay virker på USER tracks (ikke interruption)
- ✅ Skål interrupt virker på AUTOPLAY tracks
- ✅ Gammel funktionalitet bevaret (kø, playback, party)
- ✅ Performance acceptabel (<500ms per autoplay selection)
- ✅ Ingen regressions i eksisterende flows

---

## 📞 NÆSTE SKRIDT

1. **Godkend arkitektur** — er denne tilgang OK?
2. **Prioriter faser** — vil du have alt på én gang eller fase-for-fase?
3. **Implementer** — jeg kan lave koden fil-for-fil

**Spørgsmål før vi starter:**
- Skal Skål-overlay spille ALLE party tracks, eller kun første?
- Skal autoplay have en "min/max samme genre i træk" setting?
- Skal admin kunne disable intelligent autoplay (fallback til random)?

Giv mig besked hvordan du vil fortsætte!
