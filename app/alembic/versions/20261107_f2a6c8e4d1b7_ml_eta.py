"""who predicted the arrival of a trip: the ML model before the trip, telematics during it (ADR-057)

Revision ID: f2a6c8e4d1b7
Revises: e7f1c3a9b5d2
Create Date: 2026-11-07 00:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2a6c8e4d1b7"
down_revision: str | None = "e7f1c3a9b5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("predicted_by", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("trips", "predicted_by")
