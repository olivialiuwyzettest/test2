#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -x ".venv/bin/python" ]]; then
  echo "Missing .venv. Run: make install" >&2
  exit 1
fi

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"${BACKEND_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Backend port ${BACKEND_PORT} is already in use." >&2
    lsof -nP -iTCP:"${BACKEND_PORT}" -sTCP:LISTEN >&2 || true
    exit 1
  fi
  if lsof -nP -iTCP:"${FRONTEND_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Frontend port ${FRONTEND_PORT} is already in use." >&2
    lsof -nP -iTCP:"${FRONTEND_PORT}" -sTCP:LISTEN >&2 || true
    exit 1
  fi
fi

cleanup() {
  if [[ -n "${BACK_PID:-}" ]]; then kill "${BACK_PID}" 2>/dev/null || true; fi
  if [[ -n "${FRONT_PID:-}" ]]; then kill "${FRONT_PID}" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

.venv/bin/uvicorn wbr_deck_agent.api.main:app --reload --port "${BACKEND_PORT}" &
BACK_PID="$!"

# Wait for backend to come up before starting the frontend proxy.
for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
if ! curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
  echo "Backend failed to start on port ${BACKEND_PORT}." >&2
  exit 1
fi

VITE_API_TARGET="http://127.0.0.1:${BACKEND_PORT}" \
  ./scripts/npm.sh --prefix frontend run dev -- --port "${FRONTEND_PORT}" --host 127.0.0.1 --strictPort &
FRONT_PID="$!"

wait
