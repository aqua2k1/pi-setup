#!/usr/bin/env bash
# searxng — Start/stop the local SearXNG instance for pi-websearch.
#
# Uses a compose file located outside the pi-websearch npm package so the
# bundled settings.yml (with custom engine changes) survives package upgrades.
#
# Usage:
#   searxng up      Start SearXNG (docker compose up -d)
#   searxng down    Stop SearXNG (docker compose down)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/searxng/docker-compose.yml"

up() {
  mkdir -p "${SCRIPT_DIR}/searxng/core-config"

  if docker compose -f "${COMPOSE_FILE}" ps --status running 2>/dev/null | grep -q "searxng-core"; then
    echo "SearXNG is already running" >&2
    return 0
  fi

  echo "Starting SearXNG..." >&2
  docker compose -f "${COMPOSE_FILE}" up -d

  local port
  port=$(grep -E '^SEARXNG_PORT=' "${SCRIPT_DIR}/searxng/.env" 2>/dev/null | cut -d= -f2 || echo "8080")
  port="${port:-8080}"
  echo "SearXNG is starting on http://localhost:${port}" >&2
}

down() {
  echo "Stopping SearXNG..." >&2
  docker compose -f "${COMPOSE_FILE}" down
  echo "SearXNG stopped." >&2
}

case "${1:-}" in
  up)   up ;;
  down) down ;;
  *)
    echo "Usage: $0 {up|down}" >&2
    exit 1
    ;;
esac