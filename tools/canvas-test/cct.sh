#!/usr/bin/env bash
# cct — drive a Canvas test instance (the one built by setup-canvas.sh) to check what
# an exported cartridge REALLY does on import. Runs against Canvas on this machine, or
# over SSH when CCT_SSH is set. Needs bash and, for remote mode, ssh/scp.
#
#   cct.sh import <file.imscc> [course name] [importer]   import into a new test course, wait, inspect
#   cct.sh inspect [course id]                            dump what Canvas actually built
#   cct.sh reference [out.imscc]                          build a course in Canvas, export it with Canvas's own exporter
#   cct.sh template  [out.imscc]                          same, for an instructor-style template
#   cct.sh list                                           list courses (incl. soft-deleted)
#   cct.sh cleanup                                        soft-delete test courses (name ends with the suffix)
#   cct.sh sync                                           (re)copy the ruby helpers to the Canvas host
#
# Environment
#   CCT_SSH         user@host of the Canvas box; unset = Canvas is on this machine
#   CCT_SSH_KEY     ssh private key to use with CCT_SSH
#   CCT_CANVAS_DIR  Canvas checkout on that box          (default: ~/canvas-lms)
#   CCT_SUFFIX      suffix marking test courses          (default: " (cct)")
#   CCT_IMPORTER    canvas_cartridge_importer | common_cartridge_importer
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANVAS_DIR="${CCT_CANVAS_DIR:-~/canvas-lms}"
SUFFIX="${CCT_SUFFIX:- (cct)}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30)
[[ -n "${CCT_SSH_KEY:-}" ]] && SSH_OPTS+=(-i "$CCT_SSH_KEY")

on_host() {
  if [[ -n "${CCT_SSH:-}" ]]; then ssh "${SSH_OPTS[@]}" "$CCT_SSH" "$1"; else bash -c "$1"; fi
}

CANVAS_ABS=""
canvas_abs() { [[ -n "$CANVAS_ABS" ]] || CANVAS_ABS="$(on_host "cd $CANVAS_DIR && pwd")"; echo "$CANVAS_ABS"; }

to_host() { # <local file> <name under .cct/>
  local dest; dest="$(canvas_abs)/.cct/$2"
  if [[ -n "${CCT_SSH:-}" ]]; then scp -q "${SSH_OPTS[@]}" "$1" "$CCT_SSH:$dest"; else cp "$1" "$dest"; fi
}

from_host() { # <name under .cct/> <local file>
  local src; src="$(canvas_abs)/.cct/$1"
  if [[ -n "${CCT_SSH:-}" ]]; then scp -q "${SSH_OPTS[@]}" "$CCT_SSH:$src" "$2"; else cp "$src" "$2"; fi
}

sync_scripts() {
  on_host "mkdir -p $CANVAS_DIR/.cct"
  for f in "$HERE"/ruby/*.rb; do to_host "$f" "$(basename "$f")"; done
}

# Run a ruby helper inside the web container. Extra args are KEY=VALUE env vars for it.
rails_run() {
  local script="$1"; shift
  local envs=""
  for kv in "$@"; do envs+=" -e $(printf '%q' "$kv")"; done
  # Canvas/compose emit harmless deprecation noise on stderr; drop it, keep real errors.
  on_host "cd $CANVAS_DIR && docker compose exec -T$envs web bundle exec rails runner .cct/$script 2>&1 | grep -vE 'level=warning|DEPRECATION|Running via Spring' || true"
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  sync) sync_scripts; echo "ruby helpers copied to $(canvas_abs)/.cct" ;;

  import)
    file="${1:?usage: cct.sh import <file.imscc> [course name] [importer]}"
    [[ -f "$file" ]] || { echo "no such file: $file" >&2; exit 2; }
    name="${2:-$(basename "$file" .imscc)}"
    sync_scripts
    to_host "$file" upload.imscc
    out="$(rails_run import_cartridge.rb CCT_FILE=/usr/src/app/.cct/upload.imscc "CCT_NAME=$name" "CCT_SUFFIX=$SUFFIX" \
           "CCT_IMPORTER=${3:-${CCT_IMPORTER:-canvas_cartridge_importer}}")"
    echo "$out"
    id="$(sed -n 's/^COURSE_ID=//p' <<<"$out" | tail -1)"
    [[ -n "$id" ]] && { echo; rails_run inspect_import.rb "COURSE=$id"; }
    grep -q '^migration state: imported' <<<"$out" || { echo "IMPORT DID NOT COMPLETE" >&2; exit 1; }
    ;;

  inspect) sync_scripts; rails_run inspect_import.rb ${1:+COURSE=$1} ;;

  reference|template)
    out="${1:-$cmd-export.imscc}"
    sync_scripts
    rails_run "make_${cmd}_course.rb" "CCT_SUFFIX=$SUFFIX"
    from_host "$cmd-export.imscc" "$out"
    echo "wrote $out  (scrub instance details before committing it as a fixture)"
    ;;

  list)    sync_scripts; rails_run list_courses.rb ;;
  cleanup) sync_scripts; rails_run delete_test_courses.rb "CCT_SUFFIX=$SUFFIX" ;;

  help|-h|--help|*) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//' ;;
esac
