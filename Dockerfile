# ─── Stage 1: Build Go backend ───────────────────────────────
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS go-builder

WORKDIR /app

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .

ARG TARGETOS TARGETARCH
ARG GIT_COMMIT=unknown
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags="-s -w -X main.Version=${GIT_COMMIT}" -o crownjukebox ./cmd/server

# ─── Stage 2: Build frontend ──────────────────────────────────
# Always build on native host platform — JS output is platform-independent
FROM --platform=$BUILDPLATFORM node:24-alpine AS node-builder

WORKDIR /app

COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ .
RUN npm run build

# ─── Stage 3: Runtime ─────────────────────────────────────────
FROM nginx:1.27-alpine

# ca-certificates for HTTPS, tzdata for timestamps, python3+ffmpeg for yt-dlp
# Download architecture-specific yt-dlp binary (amd64 or arm64)
ARG TARGETARCH
RUN apk add --no-cache ca-certificates tzdata python3 ffmpeg curl && \
    if [ "$TARGETARCH" = "arm64" ]; then \
      curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64 \
           -o /usr/local/bin/yt-dlp; \
    else \
      curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
           -o /usr/local/bin/yt-dlp; \
    fi && \
    chmod a+rx /usr/local/bin/yt-dlp

# Go binary
COPY --from=go-builder /app/crownjukebox /app/crownjukebox

# Frontend static files
COPY --from=node-builder /app/dist /usr/share/nginx/html

# nginx config (proxies /api/ to localhost:8080)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Startup script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default dirs (overridden by volume mounts)
RUN mkdir -p /data /music /artwork_cache

# ── Environment defaults ──────────────────────────────────────
ENV PORT=8080
ENV DB_PATH=/data/crownjukebox.db
ENV MUSIC_DIR=/music
ENV ARTWORK_CACHE_DIR=/artwork_cache
ENV EXTERNAL_MUSIC_DIR=/music/youtubedownload
ENV SESSION_TTL_HOURS=168
ENV ADMIN_USERNAME=admin
ENV ALLOWED_ORIGINS=*

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost/api/playback/state || exit 1

ENTRYPOINT ["/entrypoint.sh"]
