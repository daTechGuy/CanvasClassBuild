#!/usr/bin/env bash
# setup-canvas.sh — build a Canvas LMS (dev mode) instance for testing exports, with Docker.
#
# Reproducible and resumable. Run it on an Ubuntu 22.04/24.04 box (a VM is ideal) that has
# Docker + the compose plugin, git, python3, openssl and curl, and ~8 GB RAM (+ swap), ~60 GB disk.
#
#   CCT_LAN_HOST=<canvas-host> ./setup-canvas.sh          # full build (30–90 min the first time)
#   CCT_LAN_HOST=<canvas-host> ./setup-canvas.sh fixes    # only (re)apply the config/dependency fixes
#   CCT_LAN_HOST=<canvas-host> ./setup-canvas.sh smoke    # only check that it is up and QTI is enabled
#
# Phases that finished are recorded in $CANVAS_DIR/.cct/state/; a re-run skips them
# (SETUP_FORCE=1 redoes everything). Progress lines start with "PHASE".
#
# Environment
#   CCT_LAN_HOST   address you will browse to (required)
#   CCT_PORT       host port for Canvas                       (default 3000)
#   CANVAS_DIR     where to put the Canvas checkout           (default ~/canvas-lms)
#   ADMIN_EMAIL    admin login                                (default admin@canvas-test.local)
#   ADMIN_PASSWORD admin password; generated if unset. Written (mode 600) to ~/canvas-admin.txt
#
# WHY these versions and fixes — each cost real debugging time (see README.md):
#   • Instructure's Docker Hub image is from 2019 → build from source, pinned to a commit.
#   • The dev compose file publishes no port, and Canvas's nginx listens on 80 → publish PORT:80.
#   • The pinned source imports @instructure/platform-alerts without declaring it → webpack
#     fails ("Module not found") → add the dependency.
#   • Without Instructure's QTIMigrationTool Canvas silently skips every QTI quiz on import
#     → install it into vendor/ BEFORE the containers first start (detected at boot).
set -euo pipefail

# ── Pins ─────────────────────────────────────────────────────────────────────
CANVAS_REPO="https://github.com/instructure/canvas-lms.git"
CANVAS_REF="44bfdc264d5fe6a942ebdb5f10a0eb63ee04df3a"   # branch `prod`, 2026-04-30 (stable/2026-04-22)
QTI_REPO="https://github.com/instructure/QTIMigrationTool.git"
QTI_REF="aab28af7a05142140c6fd2f45ed67a4c925a7d1b"      # 2026-03-23
PLATFORM_ALERTS_VERSION="1.0.1"

CANVAS_DIR="${CANVAS_DIR:-$HOME/canvas-lms}"
LAN_HOST="${CCT_LAN_HOST:?set CCT_LAN_HOST to the address you will browse to, e.g. 192.168.1.50}"
PORT="${CCT_PORT:-3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@canvas-test.local}"
ADMIN_FILE="$HOME/canvas-admin.txt"
STATE_DIR="$CANVAS_DIR/.cct/state"

phase() { echo; echo "PHASE $(date +%H:%M:%S) :: $*"; }

# run_phase <name> <function>: skip if already done
run_phase() {
  local name="$1" fn="$2"
  if [[ -z "${SETUP_FORCE:-}" && -f "$STATE_DIR/$name.done" ]]; then
    echo "PHASE (skipped, already done) :: $name"; return 0
  fi
  phase "$name"
  "$fn"
  mkdir -p "$STATE_DIR" && touch "$STATE_DIR/$name.done"
}

dc() { (cd "$CANVAS_DIR" && docker compose "$@"); }
dc_exec() { dc exec -T "$@"; }

# ── Phases ───────────────────────────────────────────────────────────────────
fetch_source() {
  if [[ -d "$CANVAS_DIR/.git" ]]; then
    local head; head="$(git -C "$CANVAS_DIR" rev-parse HEAD)"
    if [[ "$head" != "$CANVAS_REF" ]]; then
      echo "WARNING: $CANVAS_DIR is at ${head:0:12}, not the pinned ${CANVAS_REF:0:12}. Leaving it alone."
    fi
    return 0
  fi
  mkdir -p "$CANVAS_DIR"
  git -C "$CANVAS_DIR" init -q
  git -C "$CANVAS_DIR" remote add origin "$CANVAS_REPO"
  git -C "$CANVAS_DIR" fetch --depth 1 origin "$CANVAS_REF"     # GitHub serves any reachable commit by SHA
  git -C "$CANVAS_DIR" checkout -q FETCH_HEAD
}

install_qti_tool() {
  local dir="$CANVAS_DIR/vendor/QTIMigrationTool"
  [[ -f "$dir/migrate.py" ]] && return 0
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" remote add origin "$QTI_REPO" 2>/dev/null || true
  git -C "$dir" fetch --depth 1 origin "$QTI_REF"
  git -C "$dir" checkout -q FETCH_HEAD
}

# All of these are idempotent — safe to run on an existing checkout.
apply_fixes() {
  cd "$CANVAS_DIR"
  mkdir -p .cct
  cp docker-compose/config/*.yml config/

  # Canvas must know the address it is served from.
  sed -i "s#domain: \"canvas.docker\"#domain: \"${LAN_HOST}:${PORT}\"#" config/domain.yml

  [[ -f docker-compose.override.yml ]] || cp config/docker-compose.override.yml.example docker-compose.override.yml
  # Publish the web port. The container's nginx listens on 80 (NOT 3000).
  if ! grep -q "\"${PORT}:80\"" docker-compose.override.yml; then
    PORT="$PORT" python3 - <<'PY'
import os
p = 'docker-compose.override.yml'
s = open(p).read()
needle = "  web:\n    <<: *BASE\n"
assert needle in s, "unexpected override layout; add a ports: entry to the web service by hand"
s = s.replace(needle, needle + f'    ports:\n      - "{os.environ["PORT"]}:80"\n', 1)
open(p, 'w').write(s)
PY
  fi
  echo -n "COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml" > .env
  touch db/structure.sql && chmod a+rw db/structure.sql

  # Undeclared dependency in this source snapshot (see header).
  if grep -rqs "@instructure/platform-alerts" ui && ! grep -q '"@instructure/platform-alerts"' package.json; then
    VERSION="$PLATFORM_ALERTS_VERSION" python3 - <<'PY'
import json, os
p = 'package.json'
d = json.load(open(p))
d.setdefault('dependencies', {})['@instructure/platform-alerts'] = os.environ['VERSION']
open(p, 'w').write(json.dumps(d, indent=2) + "\n")
PY
    echo "added @instructure/platform-alerts@${PLATFORM_ALERTS_VERSION} to package.json"
  fi
  install_qti_tool
}

build_images() { dc build --pull --build-arg USER_ID="$(id -u)"; }
start_web()    { dc up -d web; sleep 10; dc ps; }
install_gems() { dc_exec web ./script/install_assets.sh -c bundle; }
install_js()   { dc_exec web ./script/install_assets.sh -c yarn; }
compile()      { dc_exec -e NODE_OPTIONS=--max-old-space-size=6144 web ./script/install_assets.sh -c compile; }

create_db() {
  dc_exec web bundle exec rake db:create
  dc_exec web bundle exec rake db:migrate RAILS_ENV=development
}

initial_setup() {
  if [[ ! -f "$ADMIN_FILE" ]]; then
    local pass="${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)}"
    (umask 077; printf 'url:      http://%s:%s/\nemail:    %s\npassword: %s\n' "$LAN_HOST" "$PORT" "$ADMIN_EMAIL" "$pass" > "$ADMIN_FILE")
  fi
  local email pass
  email="$(awk '/^email:/{print $2}' "$ADMIN_FILE")"
  pass="$(awk '/^password:/{print $2}' "$ADMIN_FILE")"
  dc_exec \
    -e CANVAS_LMS_ADMIN_EMAIL="$email" -e CANVAS_LMS_ADMIN_PASSWORD="$pass" \
    -e CANVAS_LMS_ACCOUNT_NAME="CanvasClassBuild Test" -e CANVAS_LMS_STATS_COLLECTION="opt_out" \
    web bundle exec rake db:initial_setup
}

start_jobs() { dc up -d jobs web; sleep 15; dc ps; }   # imports are background jobs: no worker, no import

smoke() {
  echo "waiting for the login page…"
  local code=000
  for _ in $(seq 1 40); do
    code="$(curl -s -o /dev/null -m 30 -w '%{http_code}' "http://localhost:${PORT}/login/canvas" || true)"
    [[ "$code" == "200" ]] && break
    sleep 5
  done
  echo "login page: HTTP $code"
  [[ "$code" == "200" ]] || { echo "Canvas is not answering on port $PORT" >&2; return 1; }

  local qti
  qti="$(dc_exec web bundle exec rails runner 'puts Qti.qti_enabled?' 2>/dev/null | tail -1)"
  echo "QTI conversion enabled: $qti"
  if [[ "$qti" != "true" ]]; then
    echo "WARNING: QTI conversion is OFF — Canvas will silently skip every quiz on import." >&2
    echo "         Check vendor/QTIMigrationTool/migrate.py exists, then: docker compose restart web jobs" >&2
    return 1
  fi
  echo "OK: http://${LAN_HOST}:${PORT}/  (admin login in $ADMIN_FILE)"
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  case "${1:-all}" in
    fixes) run_phase fetch fetch_source; apply_fixes ;;
    smoke) smoke ;;
    all)
      run_phase fetch fetch_source
      phase "apply fixes (idempotent)"; apply_fixes
      run_phase build-images build_images
      run_phase start-web    start_web
      run_phase gems         install_gems
      run_phase js-packages  install_js
      run_phase compile-assets compile
      run_phase database     create_db
      run_phase initial-setup initial_setup
      run_phase start-jobs   start_jobs
      phase "smoke test"; smoke
      phase "DONE"
      ;;
    *) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2 ;;
  esac
}

main "$@"
