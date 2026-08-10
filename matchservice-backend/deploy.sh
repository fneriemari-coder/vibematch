#!/usr/bin/env bash
#
# MatchService backend — production deploy script for a Linux/Ubuntu cloud
# host (DigitalOcean/AWS) running docker-compose.yml alongside this repo.
#
# Usage: ./deploy.sh   (run from the repo root, as a user with docker access)

set -euo pipefail

LOG_PREFIX="[deploy $(date '+%Y-%m-%d %H:%M:%S')]"

log()  { echo "${LOG_PREFIX} $*"; }
fail() { echo "${LOG_PREFIX} ERROR: $*" >&2; exit 1; }

trap 'fail "deploy aborted at line $LINENO"' ERR

[ -f "docker-compose.yml" ] || fail "docker-compose.yml not found — run this from the backend repo root"
[ -f ".env" ] || fail ".env not found — copy .env.example to .env and fill in real values first"

log "Pulling latest code from origin/main..."
git pull origin main

log "Installing production dependencies..."
npm install --only=production

log "Generating Prisma Client..."
npx prisma generate

log "Running database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

log "Rebuilding and restarting containers..."
docker-compose down
docker-compose up -d --build

log "Waiting for API health check..."
for i in $(seq 1 15); do
  if curl -sf "http://localhost:${PORT:-3000}" >/dev/null 2>&1; then
    log "API is responding."
    break
  fi
  if [ "$i" -eq 15 ]; then
    log "WARNING: API did not respond after 15 attempts — check 'docker-compose logs api'"
  fi
  sleep 2
done

log "Pruning unused Docker images to reclaim disk space..."
docker image prune -f

log "Deploy finished successfully."
