#!/bin/sh

# Start Go backend in a restart loop so that if it panics or exits,
# it comes back automatically instead of leaving nginx returning 502.
(
  while true; do
    echo "[crownjukebox] Starting Go backend on port 8080..."
    /app/crownjukebox
    CODE=$?
    echo "[crownjukebox] Go backend exited (code ${CODE}), restarting in 3s..."
    sleep 3
  done
) &

echo "[crownjukebox] Starting nginx on port 80..."
exec nginx -g 'daemon off;'
