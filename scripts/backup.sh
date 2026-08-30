#!/usr/bin/env bash
# Nightly backup of everything Rekall can't recreate: the database and the uploaded note files.
#
# Writes to the second physical drive on purpose. The point of this script is to survive the OS
# disk being wiped — a reinstall, a distro hop, a failed NVMe — so a backup living on the same
# drive as the database would be no backup at all.
#
# Exits non-zero if the target isn't mounted rather than helpfully creating the directory: a
# silent write into an empty mountpoint would look like a working backup for months and then
# turn out to be nothing.
set -euo pipefail

DEST="${REKALL_BACKUP_DIR:-/run/media/system/Home_Backup/Rekall-backups}"
NOTES_DIR="$HOME/Projects/PipCards/backend/data/notes"
CONTAINER="pipcards-db"
KEEP_DAYS=14
STAMP="$(date +%Y-%m-%d_%H%M)"

mountpoint -q "$(dirname "$DEST")" || {
  echo "Backup drive not mounted at $(dirname "$DEST") — nothing written." >&2
  exit 1
}
mkdir -p "$DEST"

# Custom format (-Fc): compressed, and restorable selectively with pg_restore rather than being a
# single all-or-nothing SQL script.
podman exec "$CONTAINER" pg_dump -U pipcards -Fc pipcards > "$DEST/rekall-db-$STAMP.dump"

# The notes directory holds the original uploads; the database only stores paths to them, so a
# database-only backup would restore a library of broken links.
if [ -d "$NOTES_DIR" ] && [ -n "$(ls -A "$NOTES_DIR" 2>/dev/null)" ]; then
  tar -czf "$DEST/rekall-notes-$STAMP.tar.gz" -C "$(dirname "$NOTES_DIR")" "$(basename "$NOTES_DIR")"
fi

# Prune old copies. Deliberately runs last: a failed dump above aborts the script (set -e), so a
# broken backup run can never delete the good copies that came before it.
find "$DEST" -name 'rekall-*' -type f -mtime "+$KEEP_DAYS" -delete

echo "Backed up to $DEST (db $(du -h "$DEST/rekall-db-$STAMP.dump" | cut -f1))"
