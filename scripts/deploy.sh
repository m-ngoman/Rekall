#!/usr/bin/env bash
# Ships main to the server this runs on. When main has moved, it fast-forwards this checkout,
# installs, builds the frontend beside the live one, runs the migrations, swaps the new build in
# and restarts the backend, then checks that a newly started backend answers.
#
# Run every five minutes by rekall-deploy.timer (see scripts/systemd/ and the README's Deploying
# section), which makes merging to main the whole release process. Quiet when main hasn't moved.
# `systemctl --user start rekall-deploy` ships at once; running this script by hand does too, but
# a dropped SSH session would interrupt it.
#
# What a failure leaves running:
#   - A failure before the restart (install, build, a migration) leaves the old backend and the
#     old build serving, and puts the checkout back on the commit that's running. Except for the
#     database: see "Migrations" below. The commit gets three tries, five minutes apart, since a
#     failure like that can be passing (the npm registry, say) and costs the site nothing.
#   - A restart that doesn't come up healthy is rolled back: previous commit, previous build,
#     previous Python packages, restarted again. That commit is then left alone until main moves
#     on: a backend that won't start fails the same way next time, and every try is an outage.
#   - A deploy that was interrupted (a timeout, a reboot, Ctrl-C) is noticed on the next run,
#     which puts the previous commit, build and packages back, restarts it, and deploys again.
#     What's running is recorded apart from the checkout's HEAD, which moves before a deploy is
#     done, for exactly this.
#   - A checkout moved by hand (a `git pull`, a deploy done by hand) is left alone, and nothing is
#     deployed until you say what's running: `scripts/deploy.sh --adopt` takes the checkout as it.
#   - While a commit waits for main to move on, each run logs one line saying so.
#     `scripts/deploy.sh --retry` gives it one more try.
#
# `scripts/deploy.sh --settings` prints the settings a run would use, and deploys nothing.
#
# The first run deploys in full (packages, build, migrations, restart) whatever the checkout was
# on, since nothing yet says what is running.
#
# Migrations are never undone automatically: that is how data gets lost. A rolled-back commit's
# migrations stay applied, so fix forward on main; reverting the commit would remove a revision
# the database is at, and alembic would refuse every deploy after it. And a failed upgrade can
# leave some migrations applied: most run in one transaction, but one using autocommit_block
# (ALTER TYPE ... ADD VALUE) commits everything before it. `alembic current` says where it is.
#
# Settings, all optional, in ~/.config/rekall/deploy.env, or in the file REKALL_CONFIG names. A
# second deploy on the same account (beta, from its own checkout) sets REKALL_CONFIG in its unit,
# so neither reads the other's REKALL_RESTART or REKALL_URL. This script reads the file itself, so
# a hand run gets the settings too, and never runs any of it: one KEY=value per line, the value
# taken as written, spaces and all, quoted or not, with $NAME and ${NAME} expanded. So both
# `REKALL_RESTART=sudo systemctl restart rekall` and `PATH=$HOME/.nvm/versions/node/v22/bin:$PATH`
# mean what they say, and a file written for systemd's EnvironmentFile, as the first version of
# this setup had it, reads the same.
#   REKALL_BRANCH       the branch to ship (main)
#   REKALL_RESTART      a command that has the backend's supervisor restart it, and returns
#                       (systemctl --user restart rekall.service). Not one that starts the server
#                       itself: under the timer, anything this run starts is stopped when it ends.
#   REKALL_URL          where the backend answers once restarted (http://127.0.0.1:8000)
#   REKALL_VENV         the backend's virtualenv (backend/.venv in this checkout)
#   REKALL_HEALTH_WAIT  seconds to wait for it to answer (60)
#   PATH                if node or npm come from somewhere only a login shell adds, like nvm
set -euo pipefail

log() { printf '%s\n' "$*"; }

# A settings value with $NAME and ${NAME} expanded, a name that isn't set to nothing, and, if it was
# in double quotes, \" \\ \$ and \` read as the character after the backslash. Nothing else: no ~,
# no $(...), no globs.
expand_value() {
  local rest=$1 escapes=$2 out="" plain name
  while [[ -n $rest ]]; do
    plain=${rest%%[\\\$]*}
    out+=$plain
    rest=${rest:${#plain}}
    if [[ -z $rest ]]; then
      break
    elif [[ $rest == \\* ]]; then
      if $escapes && [[ ${rest:1:1} == [\"\\\$\`] ]]; then
        out+=${rest:1:1}
        rest=${rest:2}
      else
        out+='\'
        rest=${rest:1}
      fi
    elif [[ $rest =~ ^\$\{([A-Za-z_][A-Za-z0-9_]*)\}(.*)$ || $rest =~ ^\$([A-Za-z_][A-Za-z0-9_]*)(.*)$ ]]; then
      name=${BASH_REMATCH[1]}
      out+=${!name-}
      rest=${BASH_REMATCH[2]}
    else
      out+='$'
      rest=${rest:1}
    fi
  done
  printf '%s' "$out"
}

# Puts a settings file's KEY=value lines into the environment without running any of them, reading
# each the way systemd's EnvironmentFile and a shell both would. Blank lines and ones starting with
# # or ; are skipped, and an `export ` in front is allowed. A value in "..." or '...' is what's
# inside; an unquoted one runs to the end of the line, less a " # comment". $NAME expands, except
# in '...'. A line that isn't KEY=value is reported and skipped, as systemd skips it.
read_settings() {
  local file=$1 line key value n=0
  local assignment='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$'
  local ignored='^[[:space:]]*([#;].*)?$'
  local double='^"((\\.|[^"\\])*)"[[:space:]]*(#.*)?$'
  local single="^'([^']*)'[[:space:]]*(#.*)?\$"
  while IFS= read -r line || [[ -n $line ]]; do
    n=$((n + 1))
    line=${line%$'\r'}
    if [[ $line =~ $ignored ]]; then
      continue
    elif [[ ! $line =~ $assignment ]]; then
      log "$file, line $n isn't KEY=value, so it was skipped: $line"
      continue
    fi
    key=${BASH_REMATCH[2]}
    value=${BASH_REMATCH[3]}
    if [[ $value == \"* ]]; then
      if [[ ! $value =~ $double ]]; then
        log "$file, line $n has no closing \", so it was skipped: $line"
        continue
      fi
      value=$(expand_value "${BASH_REMATCH[1]}" true)
    elif [[ $value == \'* ]]; then
      if [[ ! $value =~ $single ]]; then
        log "$file, line $n has no closing ', so it was skipped: $line"
        continue
      fi
      value=${BASH_REMATCH[1]}
    else
      value=${value%%[[:space:]]#*}
      value=${value%"${value##*[![:space:]]}"}
      value=$(expand_value "$value" false)
    fi
    # One bash keeps to itself (UID, say) can't be set, and trying ends the script even here, so it
    # is tried in a subshell first: better skipped than stopping every deploy.
    if (export "$key=$value") 2>/dev/null; then
      export "$key=$value"
    else
      log "$file, line $n sets $key, which can't be set, so it was skipped."
    fi
  done <"$file"
}

# REKALL_CONFIG comes from the environment, the unit's Environment= say, never from the file.
config="${REKALL_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/rekall/deploy.env}"
if [[ -f "$config" ]]; then
  read_settings "$config"
elif [[ -n "${REKALL_CONFIG:-}" ]]; then
  log "REKALL_CONFIG names $config, which isn't there; not deploying without the settings it holds."
  exit 1
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
branch="${REKALL_BRANCH:-main}"
restart_cmd="${REKALL_RESTART:-systemctl --user restart rekall.service}"
url="${REKALL_URL:-http://127.0.0.1:8000}"
venv="${REKALL_VENV:-$repo/backend/.venv}"
health_wait="${REKALL_HEALTH_WAIT:-60}"
max_tries=3

# What this script knows between runs, kept in .git so it belongs to this checkout and nothing
# ever commits it.
git_dir="$(git -C "$repo" rev-parse --absolute-git-dir)"
deployed_file="$git_dir/rekall-deployed"          # the commit that is running
progress_file="$git_dir/rekall-deploying"         # "<commit> <previous>" while a deploy is unfinished
failed_file="$git_dir/rekall-deploy-failed"       # "<commit> <tries>"
freeze="$git_dir/rekall-deploy-freeze.txt"        # packages from before a change; kept until restored
live_assets="$git_dir/rekall-live-assets"         # the files the live build made itself
next_assets="$git_dir/rekall-next-assets"         # the same, for the build being deployed

pip_quiet() { "$venv/bin/pip" install --quiet --disable-pip-version-check "$@"; }

# Everything that can fail without disturbing what's running. Every step carries its own
# `|| return`: this runs as an `if` condition, where bash ignores `set -e`, so a bare failing step
# would be skipped over rather than stop the deploy. Returns 2 when it was the migrations.
build() {
  local deps_changed=$1
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
  ls -A "$repo/frontend/dist.next/assets" >"$next_assets" || return 1
  carry_assets || return 1
  # Last, because it's the one step that changes something the running app uses.
  (cd "$repo/backend" && "$venv/bin/alembic" upgrade head) || return 2
}

# Earlier builds' hashed files, copied into the new one. A tab opened before this deploy still has
# the old index.html's chunk names, and fetches one when it first needs it (the maths renderer,
# the note editor, the plotter); a 404 there takes the whole page down. Hashed names only repeat
# for identical content, so nothing here can shadow a new file.
#
# Each file is aged from the deploy that stopped serving it, and goes a fortnight later, by which
# time no open tab still wants it. The live build's own files stop being served now, so they are
# copied with a fresh date; ones carried in by an earlier deploy keep theirs (-p). Without the
# record of which are which, everything counts as the live build's own, which keeps too much for
# a fortnight rather than too little.
carry_assets() {
  local old="$repo/frontend/dist/assets" new="$repo/frontend/dist.next/assets" f name
  [[ -d "$old" && -d "$new" ]] || return 0
  for f in "$old"/*; do
    [[ -f "$f" ]] || continue
    name="${f##*/}"
    [[ -e "$new/$name" ]] && continue
    if [[ -f "$live_assets" ]] && ! grep -qxF -- "$name" "$live_assets"; then
      cp -p "$f" "$new/" || return 1
    else
      cp "$f" "$new/" || return 1
    fi
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

# The reverse, when the build that was swapped out is still there to put back.
swap_back() {
  local fe="$repo/frontend"
  [[ -d "$fe/dist.prev" ]] || return 0
  rm -rf "$fe/dist.failed" || return 1
  if [[ -d "$fe/dist" ]]; then mv "$fe/dist" "$fe/dist.failed" || return 1; fi
  if ! mv "$fe/dist.prev" "$fe/dist"; then
    if [[ -d "$fe/dist.failed" ]]; then mv "$fe/dist.failed" "$fe/dist"; fi
    return 1
  fi
  rm -rf "$fe/dist.failed"
}

# Puts the checkout back on the commit that's running, and its Python packages with it. The
# freeze goes only once they are back, so a restore that fails is tried again by the next run
# rather than forgotten.
undo_code() {
  local prev=$1
  if ! git -C "$repo" reset --quiet --hard "$prev"; then
    log "Couldn't put the checkout back on ${prev:0:7} (a stale .git/index.lock, a full disk?)."
    return 1
  fi
  rm -rf "$repo/frontend/dist.next" "$next_assets"
  if [[ -s "$freeze" ]]; then
    if pip_quiet -r "$freeze" && pip_quiet --no-deps -e "$repo/backend"; then
      rm -f "$freeze"
    else
      log "Couldn't put the backend's previous packages back. They're listed in $freeze, and the next run tries again."
      return 1
    fi
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

# Puts back what was running before a deploy that stopped partway, or a package restore that
# failed: its commit, its packages, its build if the new one was swapped in, and a backend
# restarted on all three, since there's no telling what the running one is now. Anything that
# can't be put back leaves the progress file where it is, so the next run tries again rather than
# restarting on a checkout it couldn't fix.
recover() {
  local prev=$1 since
  log "The last deploy didn't finish; putting ${prev:0:7} back."
  undo_code "$prev" || return 1
  if ! swap_back; then
    log "Couldn't put the previous build back in place; the next run tries again."
    return 1
  fi
  rm -f "$progress_file"
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

  if [[ "${1:-}" == --settings ]]; then
    log "settings file: $config$([[ -f "$config" ]] || echo ' (none there)')"
    log "REKALL_BRANCH=$branch"
    log "REKALL_RESTART=$restart_cmd"
    log "REKALL_URL=$url"
    log "REKALL_VENV=$venv"
    log "REKALL_HEALTH_WAIT=$health_wait"
    log "PATH=$PATH"
    return 0
  fi

  # One deploy at a time: the timer never overlaps itself, but a run by hand could.
  exec 9>"$git_dir/rekall-deploy.lock"
  if ! flock -n 9; then
    log "Another deploy is running."
    return 0
  fi

  if [[ "${1:-}" == --adopt ]]; then
    if ! git diff --quiet HEAD --; then
      log "This checkout has local changes to tracked files; commit or discard them before adopting it."
      return 1
    fi
    git rev-parse HEAD >"$deployed_file"
    # The builds on disk may be anything now, so the record of which assets the live one made
    # goes too, and the next carry keeps all of them for a fortnight.
    rm -rf "$progress_file" "$failed_file" "$freeze" "$next_assets" "$live_assets" \
      "$repo/frontend/dist.prev" "$repo/frontend/dist.next"
    log "Taking $(git rev-parse --short HEAD) as what's running; deploys carry on from here."
    return 0
  fi

  # Nothing recorded yet means the first run, which deploys in full: packages, build, migrations
  # and a restart, even onto the commit already checked out. The checkout is only a guess at
  # what's running, and it is the guess a failed first deploy rolls back to.
  local recorded="" first_run=false
  if [[ -s "$deployed_file" ]]; then recorded="$(cat "$deployed_file")"; else first_run=true; fi

  # Unfinished business from an earlier run. Whatever it left in the checkout is its own, so this
  # comes before the check for local changes.
  if [[ -e "$progress_file" ]]; then
    local was_next was_prev
    read -r was_next was_prev <"$progress_file" || true
    if [[ -n "$recorded" && "$was_next" == "$recorded" ]]; then
      # It had recorded its commit as deployed, so it was done but for tidying up.
      if [[ -f "$next_assets" ]]; then mv "$next_assets" "$live_assets"; fi
      rm -rf "$repo/frontend/dist.prev" "$failed_file" "$freeze" "$progress_file"
    else
      recover "${recorded:-${was_prev:-$(git rev-parse HEAD)}}" || return 1
    fi
  elif [[ -s "$freeze" ]]; then
    recover "${recorded:-$(git rev-parse HEAD)}" || return 1
  fi

  # Tracked files only: .env, uploads and the builds are untracked, and are meant to be here.
  if ! git diff --quiet HEAD --; then
    log "This checkout has local changes to tracked files; not deploying over them."
    return 1
  fi
  local head prev
  head="$(git rev-parse HEAD)"
  prev="${recorded:-$head}"
  # A `git pull` or a deploy done by hand. Putting it back would undo someone's deliberate work,
  # and deploying on top would build over a checkout nobody knows the state of.
  if [[ "$head" != "$prev" ]]; then
    log "The checkout is on ${head:0:7}, but ${prev:0:7} is what was deployed. If ${head:0:7} is running because you deployed it, run scripts/deploy.sh --adopt; to go back, git reset --hard ${prev:0:7}. Not deploying until then."
    return 1
  fi

  git fetch --quiet origin "$branch"
  local next
  next="$(git rev-parse "origin/$branch")"
  if [[ "$prev" == "$next" ]] && ! $first_run; then return 0; fi

  local tries=0
  if [[ -f "$failed_file" ]]; then
    local failed_commit failed_tries
    read -r failed_commit failed_tries <"$failed_file" || true
    if [[ "$failed_commit" == "$next" ]]; then tries=${failed_tries:-$max_tries}; fi
  fi
  if [[ "${1:-}" == --retry ]] && ((tries > 0)); then
    # One more try for the commit that failed, not a fresh three: the timer shouldn't take it
    # from there. A commit that hasn't failed gets its usual tries.
    tries=$((max_tries - 1))
  elif ((tries >= max_tries)); then
    log "${next:0:7} failed to deploy; not trying it again until $branch moves on (or scripts/deploy.sh --retry)."
    return 1
  fi
  if ! git merge-base --is-ancestor "$prev" "$next"; then
    log "${next:0:7} doesn't build on what's running (${prev:0:7}); was $branch rewritten? Not deploying. Deploy it by hand, then run scripts/deploy.sh --adopt."
    return 1
  fi
  # A database that isn't up yet (just after a reboot, say) says nothing about the commit, so it
  # isn't counted as a try.
  if ! database_up; then
    log "Can't reach the database; will try ${next:0:7} again next time."
    return 1
  fi

  local deps_changed=false
  if $first_run; then
    log "First run: deploying ${next:0:7} in full (the checkout was on ${prev:0:7}): $(git log -1 --format=%s "$next")"
    deps_changed=true
  else
    log "Deploying ${next:0:7} over ${prev:0:7}: $(git log -1 --format=%s "$next")"
    git diff --quiet "$prev" "$next" -- backend/pyproject.toml || deps_changed=true
  fi
  # Counted as a try from the start, so a deploy that never finishes (one that always times out,
  # say) still runs out of tries. Success clears it.
  echo "$next $((tries + 1))" >"$failed_file"
  echo "$next $prev" >"$progress_file"
  # Stopped from here on (Ctrl-C, the unit's timeout, a shutdown): put the commit and the build
  # back at once, so a backend started before the next run (at boot, say) runs what it did. The
  # next run sees the progress file and finishes the job: packages, and a restart.
  trap 'git -C "$repo" reset --quiet --hard "$prev"; rm -rf "$repo/frontend/dist.next"; swap_back; exit 1' INT TERM
  if ! git merge --quiet --ff-only "$next"; then
    git -C "$repo" reset --quiet --hard "$prev" || true
    rm -f "$progress_file"
    trap - INT TERM
    log "Couldn't check out ${next:0:7} (git says why above); ${prev:0:7} is still running, untouched."
    return 1
  fi

  local status=0
  build "$deps_changed" || status=$?
  if ((status == 0)) && ! swap_in; then status=3; fi
  if ((status != 0)); then
    if ! undo_code "$prev"; then
      # The progress file stays, so the next run finishes putting things back before anything else.
      trap - INT TERM
      return 1
    fi
    rm -f "$progress_file"
    trap - INT TERM
    case $status in
      2) log "${next:0:7}'s migrations failed; ${prev:0:7} is still running, but the schema may be partly upgraded (see \`alembic current\`)." ;;
      3) log "${next:0:7} built and its migrations ran, but its build couldn't be put in place; ${prev:0:7} is still running." ;;
      *) log "${next:0:7} didn't build; ${prev:0:7} is still running, untouched." ;;
    esac
    return 1
  fi

  local since
  since="$(date +%s)"
  if restart && healthy "$since"; then
    # Done once it answers, so no stop from here on unpicks it: a kill between these lines leaves
    # either the record unwritten (the next run puts things back and tries again) or written (the
    # next run tidies up).
    trap - INT TERM
    echo "$next" >"$deployed_file"
    if [[ -f "$next_assets" ]]; then mv "$next_assets" "$live_assets"; fi
    rm -rf "$repo/frontend/dist.prev" "$failed_file" "$freeze" "$progress_file"
    log "Deployed ${next:0:7}."
    return 0
  fi

  log "${next:0:7} didn't come up healthy; rolling back to ${prev:0:7}."
  # Parked at once, and before anything else, so a stop during the rollback still leaves it
  # parked: a backend that won't start fails the same way next time, and each try is an outage.
  echo "$next $max_tries" >"$failed_file"
  if ! undo_code "$prev"; then
    trap - INT TERM
    return 1
  fi
  if ! swap_back; then
    trap - INT TERM
    log "Couldn't put the previous build back in place; the next run tries again."
    return 1
  fi
  rm -f "$progress_file"
  trap - INT TERM
  since="$(date +%s)"
  if restart && healthy "$since"; then
    log "Rolled back: ${prev:0:7} is running again. ${next:0:7} won't be tried again until $branch moves on (or scripts/deploy.sh --retry, once it's fixed). Any migrations it ran are still applied, so fix forward rather than revert."
  else
    log "The rollback didn't come up healthy either. The site may be down: check the service."
  fi
  return 1
}

# All in a function, called on the file's last line, so bash has read the whole of main before
# any of it runs. Git replaces a file rather than rewriting it, so a run that updates this
# checkout keeps reading its own copy anyway; this covers something rewriting the file in place.
main "$@"; exit $?
