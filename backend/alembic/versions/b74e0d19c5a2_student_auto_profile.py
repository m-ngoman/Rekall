"""student auto profile

Replaces auto-written memory notes with a two-layer design: an append-only signal log, and one
short profile document derived from it.

The old design could not express what it was asked for. Notes were append-only and deduplicated at
insert time by word overlap, so "tends to reach for a formula before reading the question" looked
like a duplicate of each of the three specific notes behind it and was rejected — the model was
structurally prevented from writing the generalisation. And a single 12-message window cannot see
a *recurring* pattern in the first place, because recurrence means more than one occasion. Hence
two tables: signals span occasions, the profile is derived from them.

Existing `source=auto` notes are folded into the signal log verbatim rather than deleted or
force-fitted into the new document. They are real evidence of real sessions, just recorded at the
wrong altitude, and the next few passes will consolidate them. `session_id` is NULL for these —
they predate sessions meaning anything. **Notes with `source=manual` are not touched**: the
student wrote those, and the separation between what they told us and what a model inferred is
preserved all the way into the tutor's prompt.

No enum changes, so none of the autocommit care that ADD VALUE needs (see ebcf488776da).

Revision ID: b74e0d19c5a2
Revises: f1a3c86b20d4
Create Date: 2026-09-21 17:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b74e0d19c5a2'
down_revision: Union[str, None] = 'f1a3c86b20d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'student_profiles',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('body', sa.Text(), server_default='', nullable=False),
        sa.Column('rev', sa.Integer(), server_default='0', nullable=False),
        sa.Column('passes', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_student_profiles_user_id'), 'student_profiles', ['user_id'], unique=True)

    op.create_table(
        'student_signals',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        # SET NULL rather than CASCADE: a deleted conversation should not take the evidence of
        # what happened in it with it. The profile is derived from these.
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_id'], ['tutor_sessions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_student_signals_user_id'), 'student_signals', ['user_id'], unique=False)

    op.create_table(
        'student_profile_suppressions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_student_profile_suppressions_user_id'), 'student_profile_suppressions', ['user_id'], unique=False
    )

    # Fold the auto notes into the log, keeping their original timestamps so the first rebuild can
    # still tell what happened when. gen_random_uuid() is pgcrypto, in core Postgres since 13.
    op.execute(
        """
        INSERT INTO student_signals (id, user_id, session_id, text, created_at)
        SELECT gen_random_uuid(), user_id, NULL, content, created_at
          FROM student_memory_notes
         WHERE source = 'auto'
        """
    )
    op.execute("DELETE FROM student_memory_notes WHERE source = 'auto'")


def downgrade() -> None:
    # The folded notes are not restored. They still exist as signals right up until this drops
    # the table, and reconstructing them as notes would recreate the exact design this replaced.
    op.drop_index(op.f('ix_student_profile_suppressions_user_id'), table_name='student_profile_suppressions')
    op.drop_table('student_profile_suppressions')
    op.drop_index(op.f('ix_student_signals_user_id'), table_name='student_signals')
    op.drop_table('student_signals')
    op.drop_index(op.f('ix_student_profiles_user_id'), table_name='student_profiles')
    op.drop_table('student_profiles')
