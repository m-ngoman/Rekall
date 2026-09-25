#!/usr/bin/env bash
# Ships main to the server this runs on. When main has moved, it fast-forwards this checkout,
# installs, builds the frontend beside the live one, runs the migrations, swaps the new build in
# and restarts the backend, then checks that a newly started backend answers.
#
# Run every five minutes by rekall-deploy.timer (see scripts/systemd/ and the README's Deploying
# section), which makes merging to main the whole release process. Says nothing when there is
# nothing new to ship. `systemctl --user start rekall-deploy` ships at once; running this script
# by hand does too, but a dropped SSH session would interrupt it.
#
# What a failure leaves running:
#   - A failure before the restart (install, build, a migration) leaves the old backend and the
#     old build serving, and puts the checkout back on the commit that's running. Except for the
#     database: see "Migrations" below.
#   - A restart that doesn't come up healthy is rolled back: previous commit, previous build,
#     previous Python packages, restarted again.
#   - A deploy that was interrupted (a timeout, a reboot, Ctrl-C) is noticed on the next run,
#     which puts the previous commit, build and packages back, restarts it, and deploys again.
#     What's running is recorded apart from the checkout's HEAD, which moves before a deploy is
#     done, for exactly this.
#   - A commit that fails is tried three times, five minutes apart, then left until main moves on,
#     so a broken build isn't rebuilt all day. `scripts/deploy.sh --retry` tries it again.
#
# Migrations are never undone automatically: that is how data gets lost. A rolled-back commit's
# migrations stay applied, so fix forward on main; reverting the commit would remove a revision
# the database is at, and alembic would refuse every deploy after it. And a failed upgrade can
# leave some migrations applied: most run in one transaction, but one using autocommit_block
# (ALTER TYPE ... ADD VALUE) commits everything before it. `alembic current` says where it is.
#
# Settings, all optional, as VAR=value lines in ~/.config/rekall/deploy.env, which this script
# reads itself (so a hand run gets them too, and `$PATH` and `$HOME` expand as in a shell):
#   REKALL_BRANCH       the branch to ship (main)
#   REKALL_RESTART      a command that has the backend's supervisor restart it, and returns
#                       (systemctl --user restart rekall.service). Not one that starts the server
#                       itself: under the timer, anything this run starts is stopped when it ends.
#   REKALL_URL          where the backend answers once restarted (http://127.0.0.1:8000)
#   REKALL_VENV         the backend's virtualenv (backend/.venv in this checkout)
#   REKALL_HEALTH_WAIT  seconds to wait for it to answer (60)
#   PATH                if node or npm come from somewhere only a login shell adds, like nvm
set -euo pipefail

config="${XDG_CONFIG_HOME:-$HOME/.config}/rekall/deploy.env"
if [[ -f "$config" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$config"
  set +a
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
branch="${REKALL_BRANCH:-main}"
restart_cmd="${REKALL_RESTART:-systemctl --user restart rekall.service}"
url="${REKALL_URL:-http://127.0.0.1:8000}"
venv="${REKALL_VENV:-$repo/backend/.venv}"
health_wait="${REKALL_HEALTH_WAIT:-60}"
max_tries=3

log() { printf '%s\n' "$*"; }

pip_quiet() { "$venv/bin/pip" install --quiet --disable-pip-version-check "$@"; }

# Everything that can fail without disturbing what's running. Every step carries its own
# `|| return`: this runs as an `if` condition, where bash ignores `set -e`, so a bare failing step
# would be skipped over rather than stop the deploy. Returns 2 when it was the migrations.
build() {
  local deps_changed=$1 freeze=$2
  # Only when the backend's dependencies changed: the running process imports from this venv.
  # The exact versions go into $freeze first, because putting the old requirements back isn't
  # enough to undo an upgrade: every bound here is `>=`, which the upgraded versions still meet.
  if $deps_changed; then
    "$venv/bin/pip" freeze --exclude-editable >"$freeze" || return 1
    pip_quiet -e "$repo/backend" || return 1
  fi
  # Beside the live build, not over it: vite empties its output directory when it starts writing,
  # so building in place would leave the site half a frontend for a moment, and none at all if
  # writing failed. `-- --outDir` reaches vite, the last command in the build script.
  (
    cd "$repo/frontend" &&
      npm ci --no-audit --no-fund --loglevel=error &&
      rm -rf dist.next &&
      npm run build -- --outDir dist.next
  ) || return 1
  # Last, because it's the one step that changes something the running app uses.
  (cd "$repo/backend" && "$venv/bin/alembic" upgrade head) || return 2
}

# The previous builds' hashed files, copied into the new build. A tab opened before this deploy
# still has the old index.html's chunk names, and fetches one when it first needs it (the maths
# renderer, the note editor, the plotter); a 404 there takes the whole page down. Hashed names
# only ever repeat for identical content, and -p keeps each file's age, so the old ones can go a
# fortnight after they were built, by which time no open tab still wants them.
carry_assets() {
  local old="$repo/frontend/dist/assets" new="$repo/frontend/dist.next/assets" f
  [[ -d "$old" && -d "$new" ]] || return 0
  for f in "$old"/*; do
    [[ -e "$new/${f##*/}" ]] || cp -p "$f" "$new/" || return 1
  done
  find "$new" -type f -mtime +14 -delete || return 1
}

# Two renames, so the old build is served until the moment the new one is. Undone if the second
# fails, so there is always a dist to serve.
swap_in() {
  local fe="$repo/frontend"
  rm -rf "$fe/dist.prev" || return 1
  if [[ -d "$fe/dist" ]]; then mv "$fe/dist" "$fe/dist.prev" || return 1; fi
  if ! mv "$fe/dist.next" "$fe/dist"; then
    if [[ -d "$fe/dist.prev" ]]; then mv "$fe/dist.prev" "$fe/dist"; fi
    return 1
  fi
}

swap_back() {
  local fe="$repo/frontend"
  [[ -d "$fe/dist.prev" ]] || return 0
  rm -rf "$fe/dist.failed"
  if [[ -d "$fe/dist" ]]; then mv "$fe/dist" "$fe/dist.failed"; fi
  mv "$fe/dist.prev" "$fe/dist"
  rm -rf "$fe/dist.failed"
}

# Puts the checkout back on the commit that's running, and its Python packages with it.
undo_code() {
  local prev=$1 deps_changed=$2 freeze=$3
  git -C "$repo" reset --quiet --hard "$prev"
  rm -rf "$repo/frontend/dist.next"
  if $deps_changed && [[ -s "$freeze" ]]; then
    { pip_quiet -r "$freeze" && pip_quiet --no-deps -e "$repo/backend"; } ||
      log "Couldn't put the backend's previous packages back; check $venv against $freeze."
  fi
}

# Without the lock's descriptor, so that a restart command run by hand can't hand the lock on to
# a server it leaves running.
restart() { bash -c "$restart_cmd" 9>&-; }

# Healthy means /health and / both answer, from a process started at or after $1. The old backend
# says "ok" too, and would otherwise pass for a restart that never happened. A backend from
# before /health reported `started` can't be told apart, so for one of those, answering is enough.
healthy() {
  local since=$1 _ body started
  for _ in $(seq 1 "$health_wait"); do
    if body="$(curl -fs --max-time 5 "$url/health")" && curl -fs --max-time 5 -o /dev/null "$url/"; then
      started="$(grep -o '"started":[0-9]*' <<<"$body" | cut -d: -f2 || true)"
      if [[ -z "$started" || "$started" -ge "$since" ]]; then return 0; fi
    fi
    sleep 1
  done
  return 1
}

# Puts back what was running when a deploy stopped partway, or when the checkout was moved by
# hand: its commit, its packages if they were changed, its build if the new one was swapped in,
# and a backend restarted on all three, since there's no telling what the running one is now.
recover() {
  local prev=$1 freeze=$2 progress_file=$3 since
  log "The last deploy didn't finish, or the checkout was moved by hand; putting ${prev:0:7} back."
  undo_code "$prev" true "$freeze"
  swap_back
  rm -f "$freeze" "$progress_file"
  since="$(date +%s)"
  if restart && healthy "$since"; then
    log "${prev:0:7} is running."
    return 0
  fi
  log "${prev:0:7} didn't come up healthy after being put back. The site may be down: check the service."
  return 1
}

# Whether the database answers, using the backend's own settings. Only that: `alembic current`
# would also fail when the database is at a migration this checkout doesn't have yet, which is
# exactly the state a rollback leaves for the fix that follows it.
database_up() {
  (cd "$repo/backend" && "$venv/bin/python" -c 'from app.db import engine; engine.connect().close()') >/dev/null 2>&1
}

main() {
  cd "$repo"
  local git_dir failed_file deployed_file freeze progress_file
  git_dir="$(git rev-parse --absolute-git-dir)"
  failed_file="$git_dir/rekall-deploy-failed"      # "<commit> <tries>"
  deployed_file="$git_dir/rekall-deployed"         # the commit that is running
  progress_file="$git_dir/rekall-deploying"        # there only while a deploy is unfinished
  freeze="$git_dir/rekall-deploy-freeze.txt"       # the packages from before it, when they change

  # One deploy at a time: the timer never overlaps itself, but a run by hand could.
  exec 9>"$git_dir/rekall-deploy.lock"
  if ! flock -n 9; then
    log "Another deploy is running."
    return 0
  fi

  # The first run takes the checkout as what's running, which is why the setup deploys by hand
  # once before starting the timer.
  [[ -s "$deployed_file" ]] || git rev-parse HEAD >"$deployed_file"
  local prev
  prev="$(cat "$deployed_file")"
  # A run that was killed partway: whatever it left in the checkout is its own, so no check for
  # local changes first. Unless it got as far as recording its commit as deployed, in which case
  # it was done but for tidying up.
  if [[ -e "$progress_file" ]]; then
    if [[ "$(cat "$progress_file")" == "$prev" ]]; then
      rm -rf "$freeze" "$progress_file" "$repo/frontend/dist.prev" "$failed_file"
    else
      recover "$prev" "$freeze" "$progress_file" || return 1
    fi
  fi
  # Tracked files only: .env, uploads and the builds are untracked, and are meant to be here.
  if ! git diff --quiet HEAD --; then
    log "This checkout has local changes to tracked files; not deploying over them."
    return 1
  fi
  # A `git pull` by hand leaves HEAD naming a commit that was never built or migrated.
  if [[ "$(git rev-parse HEAD)" != "$prev" ]]; then
    recover "$prev" "$freeze" "$progress_file" || return 1
  fi

  git fetch --quiet origin "$branch"
  local next
  next="$(git rev-parse "origin/$branch")"
  if [[ "$prev" == "$next" ]]; then return 0; fi

  local tries=0
  if [[ -f "$failed_file" ]]; then
    local failed_commit failed_tries
    read -r failed_commit failed_tries <"$failed_file" || true
    if [[ "$failed_commit" == "$next" ]]; then tries=${failed_tries:-$max_tries}; fi
  fi
  if [[ "${1:-}" == --retry ]]; then
    tries=0
  elif ((tries >= max_tries)); then
    log "${next:0:7} failed to deploy $tries times; waiting for $branch to move on (or run with --retry)."
    return 1
  fi
  if ! git merge-base --is-ancestor "$prev" "$next"; then
    log "${next:0:7} doesn't build on what's running (${prev:0:7}); was $branch rewritten? Not deploying."
    return 1
  fi
  # A database that isn't up yet (just after a reboot, say) says nothing about the commit, so it
  # isn't counted as a try.
  if ! database_up; then
    log "Can't reach the database; will try ${next:0:7} again next time."
    return 1
  fi

  log "Deploying ${next:0:7} over ${prev:0:7}: $(git log -1 --format=%s "$next")"
  local deps_changed=false
  git diff --quiet "$prev" "$next" -- backend/pyproject.toml || deps_changed=true
  rm -f "$freeze"
  # Counted as a try from the start, so a deploy that never finishes (one that always times out,
  # say) still runs out of tries. Success clears it.
  echo "$next $((tries + 1))" >"$failed_file"
  echo "$next" >"$progress_file"
  # Stopped from here on (Ctrl-C, the unit's timeout, a shutdown): put the commit and the build
  # back at once, so a backend started before the next run (at boot, say) runs what it did. The
  # next run sees the progress file and finishes the job: packages, and a restart.
  trap 'git -C "$repo" reset --quiet --hard "$prev"; rm -rf "$repo/frontend/dist.next"; swap_back; exit 1' INT TERM
  git merge --quiet --ff-only "$next"

  local status=0
  build "$deps_changed" "$freeze" || status=$?
  if ((status == 0)) && ! carry_assets; then status=1; fi
  if ((status == 0)) && ! swap_in; then status=1; fi
  if ((status != 0)); then
    undo_code "$prev" "$deps_changed" "$freeze"
    rm -f "$progress_file"
    trap - INT TERM
    if ((status == 2)); then
      log "${next:0:7}'s migrations failed; ${prev:0:7} is still running, but the schema may be partly upgraded (see \`alembic current\`)."
    else
      log "${next:0:7} didn't build; ${prev:0:7} is still running, untouched."
    fi
    return 1
  fi

  local since
  since="$(date +%s)"
  if restart && healthy "$since"; then
    echo "$next" >"$deployed_file"
    rm -rf "$repo/frontend/dist.prev" "$failed_file" "$freeze" "$progress_file"
    trap - INT TERM
    log "Deployed ${next:0:7}."
    return 0
  fi

  log "${next:0:7} didn't come up healthy; rolling back to ${prev:0:7}."
  undo_code "$prev" "$deps_changed" "$freeze"
  swap_back
  rm -f "$progress_file"
  trap - INT TERM
  since="$(date +%s)"
  if restart && healthy "$since"; then
    log "Rolled back: ${prev:0:7} is running again. Any migrations ${next:0:7} ran are still applied, so fix forward rather than revert."
  else
    log "The rollback didn't come up healthy either. The site may be down: check the service."
  fi
  return 1
}

# All in a function, called on the file's last line, so bash has read the whole of main before
# any of it runs. Git replaces a file rather than rewriting it, so a run that updates this
# checkout keeps reading its own copy anyway; this covers something rewriting the file in place.
main "$@"; exit $?
