#!/usr/bin/env bash
# Adam's bug inbox, filed from the tutor composer with `/bug ...` (see backend/app/api/bugs.py).
# Reads the database directly rather than the API so it works from a terminal with no session
# cookie — this is the side Claude reads them from.
#
#   scripts/bugs.sh              open reports, newest first
#   scripts/bugs.sh all          include resolved ones
#   scripts/bugs.sh done <id>    mark one resolved (id prefix is enough)
set -euo pipefail

psql() { podman exec -i pipcards-db psql -U pipcards -d pipcards "$@"; }

case "${1:-open}" in
  done)
    [ $# -ge 2 ] || { echo "usage: $0 done <id-prefix>" >&2; exit 2; }
    psql -v ON_ERROR_STOP=1 -c \
      "update bug_reports set resolved_at = now() where id::text like '$2%' and resolved_at is null returning left(id::text, 8) as id, text;"
    ;;
  open|all)
    where="where resolved_at is null"
    [ "${1:-open}" = all ] && where=""
    psql -P pager=off -c "
      select left(id::text, 8) as id,
             to_char(created_at at time zone 'UTC', 'MM-DD HH24:MI') as filed,
             case when resolved_at is null then '' else 'done' end as state,
             text,
             coalesce(context->>'viewport', '') as viewport
        from bug_reports $where
       order by created_at desc;"
    ;;
  *) echo "usage: $0 [open|all|done <id-prefix>]" >&2; exit 2 ;;
esac
