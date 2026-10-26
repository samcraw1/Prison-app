#!/usr/bin/env bash
# Runs the integration tests against a throwaway Next dev server wired to a fake Daily API.
# Requires local Supabase (npx supabase start) and a freshly seeded DB (npm run db:reset).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3101
DAILY_API_KEY=test DAILY_API_URL=http://127.0.0.1:4999 npx next dev -p $PORT > /tmp/kinline-int-dev.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 1; done
APP_URL=http://localhost:$PORT npx vitest run "$@"
