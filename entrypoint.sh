#!/bin/sh
set -e

echo "[crownjukebox] Starting Go backend on port 8080..."
/app/crownjukebox &

echo "[crownjukebox] Starting nginx on port 80..."
exec nginx -g 'daemon off;'
