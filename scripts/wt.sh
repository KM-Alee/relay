#!/usr/bin/env bash
# Relay worktree helper — see docs/13-parallel-development.md §6
#   scripts/wt.sh new T-124 escalation-timer
#   scripts/wt.sh list
#   scripts/wt.sh rm T-124
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WT_BASE="$(dirname "$ROOT")/relay-wt"

usage() { sed -n '2,5p' "$0"; exit 1; }
num_of() { echo "$1" | tr -dc '0-9' | sed 's/^0*//'; }

cmd="${1:-}"; shift || true
case "$cmd" in
  new)
    [[ $# -ge 2 ]] || usage
    id="$(echo "$1" | tr '[:upper:]' '[:lower:]')"; slug="$2"
    n="$(num_of "$id")"; [[ -n "$n" ]] || { echo "bad task id: $1"; exit 1; }
    branch="${id}-${slug}"; dir="$WT_BASE/$branch"
    mkdir -p "$WT_BASE"
    base="main"
    if git -C "$ROOT" remote get-url origin >/dev/null 2>&1; then
      git -C "$ROOT" fetch -q origin main && base="origin/main"
    fi
    git -C "$ROOT" worktree add -b "$branch" "$dir" "$base"
    port=$((3100 + n % 100)); suffix="_t${n}"
    src="$ROOT/apps/web/.env.local"
    if [[ -f "$src" ]]; then
      mkdir -p "$dir/apps/web"
      # suffix database names (…/relay → …/relay_t124) and set PORT
      sed -E \
        -e "s#^(DATABASE_URL(_UNPOOLED)?=.*/)([A-Za-z0-9_]+)(\?.*)?\$#\1\3${suffix}\4#" \
        -e "s#^(TEST_DATABASE_URL(_UNPOOLED)?=.*/)([A-Za-z0-9_]+)(\?.*)?\$#\1\3${suffix}\4#" \
        "$src" > "$dir/apps/web/.env.local"
      grep -q '^PORT=' "$dir/apps/web/.env.local" \
        && sed -i -E "s/^PORT=.*/PORT=${port}/" "$dir/apps/web/.env.local" \
        || echo "PORT=${port}" >> "$dir/apps/web/.env.local"
    else
      echo "note: $src not found; copy .env.example into the worktree manually"
    fi
    if command -v pnpm >/dev/null 2>&1 && [[ -f "$dir/package.json" ]]; then (cd "$dir" && pnpm i --prefer-offline >/dev/null); fi
    echo "worktree: $dir"; echo "branch:   $branch"; echo "port:     $port"; echo "db:       *${suffix} (created by test setup / pnpm db:migrate)"
    ;;
  list) git -C "$ROOT" worktree list ;;
  rm)
    [[ $# -ge 1 ]] || usage
    id="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
    dir="$(git -C "$ROOT" worktree list --porcelain | awk '/^worktree /{print $2}' | grep "/relay-wt/${id}-" | head -n1 || true)"
    [[ -n "$dir" ]] || { echo "no worktree for $1"; exit 1; }
    git -C "$ROOT" worktree remove "$dir"
    echo "removed $dir (branch kept; delete it after merge with: git branch -d $(basename "$dir"))"
    ;;
  *) usage ;;
esac
