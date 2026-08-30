"""notes fts index add simple lexemes for prefix search

Revision ID: a2088e02c41a
Revises: affbc942f5a3
Create Date: 2026-08-20 20:40:18.534827

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2088e02c41a'
down_revision: Union[str, None] = 'affbc942f5a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The doubled parens are required, not stylistic: Postgres only accepts a bare function call
# unparenthesized in an index definition, so any operator expression (here `||`) needs its own
# set — without them CREATE INDEX fails with `syntax error at or near "||"`.
_ENGLISH_ONLY = "(to_tsvector('english', coalesce(ocr_text, '')))"
_WITH_SIMPLE = (
    "(to_tsvector('english', coalesce(ocr_text, '')) || to_tsvector('simple', coalesce(ocr_text, '')))"
)


def upgrade() -> None:
    # Prefix search ("chloro" should find "chloroplasts") stems the *partial* word before matching,
    # and the english snowball stemmer mangles fragments: 'oxy' -> 'oxi', which is not a prefix of
    # the indexed 'oxygen', so any partial word ending in y silently matched nothing. Indexing the
    # unstemmed ('simple') lexemes alongside the english stems lets the query match raw prefixes
    # while full-word queries still benefit from stemming. Query expression in app/api/notes.py
    # must keep matching this one exactly or the planner drops back to a seq scan.
    op.execute("DROP INDEX IF EXISTS ix_notes_ocr_text_fts")
    op.execute(f"CREATE INDEX ix_notes_ocr_text_fts ON notes USING gin ({_WITH_SIMPLE})")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notes_ocr_text_fts")
    op.execute(f"CREATE INDEX ix_notes_ocr_text_fts ON notes USING gin ({_ENGLISH_ONLY})")
