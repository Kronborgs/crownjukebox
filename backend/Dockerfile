# ─── Stage 1: Build ──────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go module files first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build a statically linked binary (pure Go — no CGO needed with modernc.org/sqlite)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o crownjukebox ./cmd/server

# ─── Stage 2: Runtime ─────────────────────────────────────────
FROM alpine:3.20

# ca-certificates for HTTPS calls (e.g. Subsonic)
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/crownjukebox .

# Default directories (override with volumes)
RUN mkdir -p /data /music /artwork_cache

ENV PORT=8080
ENV DB_PATH=/data/crownjukebox.db
ENV MUSIC_DIR=/music
ENV ARTWORK_CACHE_DIR=/artwork_cache
ENV SESSION_TTL_HOURS=168
ENV ADMIN_USERNAME=admin
ENV ADMIN_PASSWORD=changeme

EXPOSE 8080

# Run as non-root
RUN addgroup -S cj && adduser -S cj -G cj
RUN chown -R cj:cj /data /artwork_cache
USER cj

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/playback/state || exit 1

ENTRYPOINT ["./crownjukebox"]
