#!/usr/bin/env bash
# Ships main to the server this runs on. When main has moved, it fast-forwards this checkout,
# installs, builds the frontend beside the live one, runs the migrations, swaps the new build in
# and restarts the backend, then checks the app answers.
#
# Run every few minutes by rekall-deploy.timer (see scripts/systemd/ and the README's Deploying
# section), which makes merging to main the whole release process. Says nothing when main hasn't
# moved, so the journal only holds deploys. Safe to run by hand, to deploy now.
#
# What a failure leaves running:
#   - Anything that fails before the restart (fetch, install, build, a migration) leaves the
#     running app exactly as it was, and puts the checkout back on the commit it's running.
#   - A restart that doesn't come up healthy is rolled back: previous commit, previous build,
#     restarted again. Migrations the new commit ran are kept; undoing a schema change
#     automatically is how data gets lost.
#   - Either way that commit isn't tried again until main moves on, so a broken build isn't
#     rebuilt every five minutes. `scripts/deploy.sh --retry` tries it again.
#
# Settings, all optional, from the environment (the timer reads ~/.config/rekall/deploy.env):
#   REKALL_BRANCH       the branch to ship (main)
#   REKALL_RESTART      the command that restarts the backend (systemctl --user restart rekall.service)
#   REKALL_URL          where the backend answers once restarted (http://127.0.0.1:8000)
#   REKALL_VENV         the backend's virtualenv (backend/.venv in this checkout)
#   REKALL_HEALTH_WAIT  seconds to wait for it to answer (60)
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
branch="${REKALL_BRANCH:-main}"
restart_cmd="${REKALL_RESTART:-systemctl --user restart rekall.service}"
url="${REKALL_URL:-http://127.0.0.1:8000}"
venv="${REKALL_VENV:-$repo/backend/.venv}"
health_wait="${REKALL_HEALTH_WAIT:-60}"

log() { printf '%s\n' "$*"; }

# Everything that can fail without disturbing what's running, most likely failure first. Every
# step carries its own `|| return 1`: this runs as an `if` condition, where bash ignores `set -e`,
# so a bare failing step would be skipped over rather than stop the deploy.
build() {
  local deps_changed=$1
  # Only when the backend's dependencies changed: the running process imports from this venv.
  if $deps_changed; then
    "$venv/bin/pip" install --quiet --disable-pip-version-check -e "$repo/backend" || return 1
  fi
  # Beside the live build, not over it: vite empties its output directory first, so building in
  # place would leave the site without a frontend for as long as the build takes, and with none
  # at all if it failed. `-- --outDir` reaches vite, the last command in the build script.
  (
    cd "$repo/frontend" &&
      npm ci --no-audit --no-fund --loglevel=error &&
      rm -rf dist.next &&
      npm run build -- --outDir dist.next
  ) || return 1
  # Last, because it's the one step that changes something the running app uses. Each run is one
  # transaction, so a migration that fails leaves the schema as it was.
  (cd "$repo/backend" && "$venv/bin/alembic" upgrade head) || return 1
}

# Two renames, so the old build is served until the moment the new one is.
swap_in() {
  cd "$repo/frontend"
  rm -rf dist.prev
  if [[ -d dist ]]; then mv dist dist.prev; fi
  mv dist.next dist
  cd "$repo"
}

swap_back() {
  cd "$repo/frontend"
  if [[ -d dist.prev ]]; then
    rm -rf dist.failed
    if [[ -d dist ]]; then mv dist dist.failed; fi
    mv dist.prev dist
    rm -rf dist.failed
  fi
  cd "$repo"
}

# Puts the checkout back on the commit that's running, and its dependencies with it.
undo_code() {
  local prev=$1 deps_changed=$2
  git reset --quiet --hard "$prev"
  rm -rf "$repo/frontend/dist.next"
  if $deps_changed; then
    "$venv/bin/pip" install --quiet --disable-pip-version-check -e "$repo/backend" ||
      log "Couldn't reinstall the backend's previous dependencies; check $venv."
  fi
}

# Without the lock's descriptor: a restart command that starts the backend itself, rather than
# asking systemd to, would otherwise hand the lock to the server and hold it for as long as it runs.
restart() { bash -c "$restart_cmd" 9>&-; }

# /health says the new process imported and started; / says it found the built frontend.
healthy() {
  local _
  for _ in $(seq 1 "$health_wait"); do
    if curl -fs -o /dev/null "$url/health" && curl -fs -o /dev/null "$url/"; then return 0; fi
    sleep 1
  done
  return 1
}

main() {
  cd "$repo"
  local git_dir failed_file
  git_dir="$(git rev-parse --absolute-git-dir)"
  failed_file="$git_dir/rekall-deploy-failed"

  # One deploy at a time: the timer never overlaps itself, but a run by hand could.
  exec 9>"$git_dir/rekall-deploy.lock"
  if ! flock -n 9; then
    log "Another deploy is running."
    return 0
  fi

  git fetch --quiet origin "$branch"
  local prev next
  prev="$(git rev-parse HEAD)"
  next="$(git rev-parse "origin/$branch")"
  if [[ "$prev" == "$next" ]]; then return 0; fi

  if [[ "${1:-}" != --retry && -f "$failed_file" && "$(cat "$failed_file")" == "$next" ]]; then
    log "${next:0:7} failed to deploy; waiting for $branch to move on (or run with --retry)."
    return 1
  fi
  # Tracked files only: .env, uploads and the builds are untracked, and are meant to be here.
  if ! git diff --quiet HEAD --; then
    log "This checkout has local changes to tracked files; not deploying over them."
    return 1
  fi
  if ! git merge-base --is-ancestor HEAD "$next"; then
    log "${next:0:7} doesn't build on what's running (${prev:0:7}); was $branch rewritten? Not deploying."
    return 1
  fi

  log "Deploying ${next:0:7} over ${prev:0:7}: $(git log -1 --format=%s "$next")"
  git merge --quiet --ff-only "$next"
  local deps_changed=false
  git diff --quiet "$prev" "$next" -- backend/pyproject.toml || deps_changed=true

  if ! build "$deps_changed"; then
    undo_code "$prev" "$deps_changed"
    echo "$next" >"$failed_file"
    log "${next:0:7} didn't build; ${prev:0:7} is still running, untouched."
    return 1
  fi

  swap_in
  if restart && healthy; then
    rm -rf "$repo/frontend/dist.prev" "$failed_file"
    log "Deployed ${next:0:7}."
    return 0
  fi

  log "${next:0:7} didn't come up healthy; rolling back to ${prev:0:7}."
  echo "$next" >"$failed_file"
  undo_code "$prev" "$deps_changed"
  swap_back
  if restart && healthy; then
    log "Rolled back: ${prev:0:7} is running again. Any migrations ${next:0:7} ran were kept."
  else
    log "The rollback didn't come up healthy either. The site may be down: check the service."
  fi
  return 1
}

# All in a function, called on the file's last line: this script is part of the checkout it
# updates, and bash reads a script as it runs it, so a new version landing mid-run would otherwise
# have the old run carry on reading from the new file.
main "$@"; exit $?
