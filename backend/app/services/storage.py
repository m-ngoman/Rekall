"""Local disk storage for uploaded note photos/PDFs — no cloud blob store, matching the rest of
the app's local-first posture (Postgres via podman, local Whisper fallback, etc.). Adam confirmed
local disk is fine for now; revisit if this ever needs to survive a container rebuild or run
across machines.
"""

import uuid
from pathlib import Path

from app.config import settings


def save_note_file(user_id: uuid.UUID, data: bytes, extension: str) -> str:
    user_dir = Path(settings.notes_storage_dir) / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    path = user_dir / f"{uuid.uuid4()}.{extension}"
    path.write_bytes(data)
    return str(path)
