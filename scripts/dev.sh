#!/usr/bin/env bash
# Run Waypoint locally on the Mac: FastAPI backend (:8000) + Vite dev server (:5173).
#
# The Vite dev server proxies API calls to the backend, so both come up together.
# Nothing here needs the ThinkPad: the whole map + data experience runs on the Mac.
# Only the Copper chat panel calls an external LLM (see .env), and it degrades
# gracefully when no LLM host is reachable.
#
# Ctrl-C stops both. Open http://127.0.0.1:5173 once Vite prints "ready".
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/python ]; then
  echo "No .venv found. Run 'make install' first." >&2
  exit 1
fi

# Kill the whole process group (backend + frontend) when this script exits.
trap 'kill 0' EXIT

.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
npm --prefix frontend run dev
