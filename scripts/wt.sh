#!/usr/bin/env bash
# Relay worktree helper — see docs/13-parallel-development.md §6
#   scripts/wt.sh new T-124 escalation-timer   # worktree ../relay-wt/t-124-escalation-timer (+ env, DB suffix, PORT, pnpm i)
#   scripts/wt.sh env T-124                    # (inside any worktree, e.g. Agent-tool ones) write apps/web/.env.local
#   scripts/wt.sh list
#   scripts/wt.sh rm T-124 [--purge]           # --purge also drops its *_t124 databases and deletes the branch
# Env: WT_BASE_REF=<ref> overrides the base (default origin/main, or local main without a remote).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MAIN="$(git -C "$ROOT" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
WT_BASE="$(dirname "$MAIN")/relay-wt"

usage() { sed -n '2,8p' "$0"; exit 1; }
num_of() { echo "$1" | tr -dc '0-9' | sed 's/^0*//'; }

# write_env <dest-root> <task-number>: copy MAIN's apps/web/.env.local with DB names suffixed _t<n>, PORT set.
write_env() {
  local dest="$1" n="$2" src="$MAIN/apps/web/.env.local"
  local port=$((3100 + n % 100)) suffix="_t${n}"
  if [[ ! -f "$src" ]]; then
    echo "note: $src not found; copy .env.example to $dest/apps/web/.env.local manually"
    return 0
  fi
  mkdir -p "$dest/apps/web"
  # suffix database names (…/relay → …/relay_t124, …/relay_test → …/relay_test_t124); idempotent.
  sed -E \
    -e "/^(TEST_)?DATABASE_URL(_UNPOOLED)?=/{/_t[0-9]+(\?.*)?(\s|$)/!s#^((TEST_)?DATABASE_URL(_UNPOOLED)?=[^ ]*/)([A-Za-z0-9_]+)(\?[^ ]*)?#\1\4${suffix}\5#}" \
    "$src" > "$dest/apps/web/.env.local.tmp"
  if grep -q '^PORT=' "$dest/apps/web/.env.local.tmp"; then
    sed -i -E "s/^PORT=.*/PORT=${port}/" "$dest/apps/web/.env.local.tmp"
  else
    echo "PORT=${port}" >> "$dest/apps/web/.env.local.tmp"
  fi
  mv "$dest/apps/web/.env.local.tmp" "$dest/apps/web/.env.local"
  echo "env:      $dest/apps/web/.env.local (port ${port}, db *${suffix})"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  new)
    [[ $# -ge 2 ]] || usage
    id="$(echo "$1" | tr '[:upper:]' '[:lower:]')"; slug="$2"
    n="$(num_of "$id")"; [[ -n "$n" ]] || { echo "bad task id: $1"; exit 1; }
    branch="${id}-${slug}"; dir="$WT_BASE/$branch"
    mkdir -p "$WT_BASE"
    base="${WT_BASE_REF:-main}"
    if [[ -z "${WT_BASE_REF:-}" ]] && git -C "$MAIN" remote get-url origin >/dev/null 2>&1; then
      git -C "$MAIN" fetch -q origin main && base="origin/main"
    fi
    git -C "$MAIN" worktree add -b "$branch" "$dir" "$base"
    write_env "$dir" "$n"
    if command -v pnpm >/dev/null 2>&1 && [[ -f "$dir/package.json" ]]; then
      (cd "$dir" && pnpm i --prefer-offline --frozen-lockfile >/dev/null)
    fi
    echo "worktree: $dir"; echo "branch:   $branch (from $base)"
    echo "db:       created + migrated by the test setup / pnpm db:migrate"
    ;;
  env)
    [[ $# -ge 1 ]] || usage
    n="$(num_of "$1")"; [[ -n "$n" ]] || { echo "bad task id: $1"; exit 1; }
    [[ "$ROOT" != "$MAIN" ]] || { echo "refusing: run this inside a worktree, not the main checkout"; exit 1; }
    write_env "$ROOT" "$n"
    ;;
  list) git -C "$MAIN" worktree list ;;
  rm)
    [[ $# -ge 1 ]] || usage
    id="$(echo "$1" | tr '[:upper:]' '[:lower:]')"; purge="${2:-}"
    dir="$(git -C "$MAIN" worktree list --porcelain | awk '/^worktree /{print $2}' | grep "/relay-wt/${id}-" | head -n1 || true)"
    [[ -n "$dir" ]] || { echo "no worktree for $1"; exit 1; }
    branch="$(basename "$dir")"
    if [[ "$purge" == "--purge" ]]; then
      (cd "$dir" && pnpm --silent --filter @relay/db drop-worktree-dbs) || echo "warn: could not drop databases"
    fi
    git -C "$MAIN" worktree remove --force "$dir"
    if [[ "$purge" == "--purge" ]]; then
      git -C "$MAIN" branch -D "$branch"
    else
      echo "removed $dir (branch kept; delete it after merge with: git branch -d $branch)"
    fi
    ;;
  *) usage ;;
esac
