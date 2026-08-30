"""add notes fulltext index

Revision ID: affbc942f5a3
Revises: 4d97b779f2f7
Create Date: 2026-08-20 20:29:41.891532

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'affbc942f5a3'
down_revision: Union[str, None] = '4d97b779f2f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Expression index backing notes search (see list_notes in app/api/notes.py). The expression
    # must match the query's exactly — same 'english' regconfig, same coalesce — or the planner
    # won't use it. The 2-arg to_tsvector with a literal regconfig is IMMUTABLE, which is what
    # makes it indexable at all; the 1-arg form depends on a session GUC and would be rejected.
    op.execute(
        "CREATE INDEX ix_notes_ocr_text_fts ON notes "
        "USING gin (to_tsvector('english', coalesce(ocr_text, '')))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notes_ocr_text_fts")
