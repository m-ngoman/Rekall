"""add text notes

Notes typed straight into the app: a third file type with no original file behind it.

Revision ID: 89f1e5891a57
Revises: 4e4a7bc7b686
Create Date: 2026-09-02 18:58:22.442504

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '89f1e5891a57'
down_revision: Union[str, None] = '4e4a7bc7b686'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Same pattern as c31a7f204e88: ADD VALUE goes on an autocommit connection because Postgres
    # won't let the new label be used in the transaction that added it.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE note_file_type ADD VALUE IF NOT EXISTS 'text'")
    op.alter_column('notes', 'storage_path', existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    # Typed notes have no file to point at, so they have to go before the column can be NOT NULL
    # again. The enum label stays: Postgres has no DROP VALUE.
    op.execute("DELETE FROM notes WHERE file_type = 'text'")
    op.alter_column('notes', 'storage_path', existing_type=sa.String(), nullable=False)
