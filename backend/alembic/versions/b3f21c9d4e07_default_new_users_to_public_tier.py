"""default new users to the public tier

The column defaulted to `friend`, which is the cost-absorbed tier: `has_text_ai` and `has_voice`
in core/entitlements.py short-circuit True for it and `bills()` returns False. Together with both
creation paths hardcoding `friend`, that meant every account the app could create rode free and
`require_text_ai` / `require_voice` were unreachable in production.

This only moves the *default*. Existing rows keep whatever they have, which is the point — the
accounts already on `friend` are actual friends and stay that way. New signups get `public`, and a
future creation path that forgets to name a tier now fails closed instead of handing out free AI.

Written by hand: autogenerate does not diff server_default, so it sees no change here at all.

Revision ID: b3f21c9d4e07
Revises: 6eae338ee38a
Create Date: 2026-09-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b3f21c9d4e07'
down_revision: Union[str, None] = '6eae338ee38a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TIER = postgresql.ENUM('friend', 'public', name='user_tier', create_type=False)


def upgrade() -> None:
    op.alter_column('users', 'tier', existing_type=_TIER, server_default='public')


def downgrade() -> None:
    op.alter_column('users', 'tier', existing_type=_TIER, server_default='friend')
