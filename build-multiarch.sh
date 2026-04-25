#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# CrownJukebox — Multi-arch Docker build & push script
# Builds linux/amd64 + linux/arm64 (Raspberry Pi 4/5, Apple Silicon)
# Requires: docker buildx, docker login
# Usage:
#   ./build-multiarch.sh [TAG]       e.g. ./build-multiarch.sh 1.0.0
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

TAG="${1:-latest}"
REGISTRY="ghcr.io/kronborgs"
BACKEND_IMAGE="${REGISTRY}/crownjukebox-backend"
FRONTEND_IMAGE="${REGISTRY}/crownjukebox-frontend"
PLATFORMS="linux/amd64,linux/arm64"

echo "Building CrownJukebox v${TAG} for platforms: ${PLATFORMS}"

# Ensure buildx builder exists
docker buildx inspect cj-builder &>/dev/null || \
  docker buildx create --name cj-builder --use --bootstrap

# ─── Backend ──────────────────────────────────────────────────
echo ""
echo "▶ Building backend..."
docker buildx build \
  --platform "${PLATFORMS}" \
  --tag "${BACKEND_IMAGE}:${TAG}" \
  --tag "${BACKEND_IMAGE}:latest" \
  --file backend/Dockerfile \
  --push \
  ./backend

# ─── Frontend ─────────────────────────────────────────────────
echo ""
echo "▶ Building frontend..."
docker buildx build \
  --platform "${PLATFORMS}" \
  --tag "${FRONTEND_IMAGE}:${TAG}" \
  --tag "${FRONTEND_IMAGE}:latest" \
  --file frontend/Dockerfile \
  --push \
  ./frontend

echo ""
echo "✓ Multi-arch build complete: ${BACKEND_IMAGE}:${TAG}, ${FRONTEND_IMAGE}:${TAG}"
