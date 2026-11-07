"""work shift of a dispatcher (phase 7b)

Revision ID: c4e7a9b2d5f1
Revises: b8d2e6f4a1c9
Create Date: 2026-11-07 23:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4e7a9b2d5f1"
down_revision: str | None = "b8d2e6f4a1c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("shift", sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "shift")
