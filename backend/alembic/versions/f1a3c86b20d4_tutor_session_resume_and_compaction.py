"""tutor session resume and compaction

Two changes that arrive together because they are the same feature seen from two sides.

Resume: until now the frontend created a session on every mount of the tutor screen, so a refresh
or a trip to another tab started a new conversation and left the old one unreachable — there was
no list endpoint and no way to delete one. Rows therefore accumulated one empty session per page
visit, forever. The data-only DELETE below clears that backlog; `_purge_empty_sessions` in
app/api/tutor.py keeps it from coming back. Nothing with a message in it is touched, so nothing a
student could ever have seen is removed.

Compaction: a conversation is re-sent in full on every turn, so what it costs per turn grows with
its length — and a conversation that now survives a refresh gets long. `summary` holds a
paragraph standing in for every message at or before `summarized_through`; those rows are NOT
deleted, because memory extraction still reads them and a resumed transcript is still built from
them. `last_prompt_tokens` is the provider's own count off the previous reply, which is what
decides when to compact — measured rather than estimated from a message count, since eighty terse
spoken turns and eighty long typed ones are wildly different amounts of context.

No enum changes here, deliberately: every column added is a plain type, so none of this needs the
autocommit dance that ADD VALUE does (see ebcf488776da).

Revision ID: f1a3c86b20d4
Revises: c7d914ab35e2
Create Date: 2026-09-21 16:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a3c86b20d4'
down_revision: Union[str, None] = 'c7d914ab35e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tutor_sessions', sa.Column('summary', sa.Text(), nullable=True))
    op.add_column('tutor_sessions', sa.Column('summarized_through', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tutor_sessions', sa.Column('last_prompt_tokens', sa.Integer(), nullable=True))

    # The accumulated backlog of sessions nobody ever spoke in. NOT EXISTS rather than NOT IN:
    # `session_id` is non-nullable so they are equivalent here, but NOT IN against a subquery that
    # could ever yield a NULL returns no rows at all, and that failure is silent.
    op.execute(
        """
        DELETE FROM tutor_sessions s
         WHERE NOT EXISTS (SELECT 1 FROM tutor_messages m WHERE m.session_id = s.id)
        """
    )


def downgrade() -> None:
    # The columns come back empty, which is correct — a dropped summary is not worth reconstructing
    # and the next turn simply carries the full history again.
    op.drop_column('tutor_sessions', 'last_prompt_tokens')
    op.drop_column('tutor_sessions', 'summarized_through')
    op.drop_column('tutor_sessions', 'summary')
    # The deleted sessions cannot be restored. They held no messages, so there is nothing to
    # restore them from and nothing was lost, but it is a one-way step and should be read as one.
