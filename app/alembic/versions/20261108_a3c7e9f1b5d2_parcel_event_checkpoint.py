"""checkpoint of a parcel event (phase 7d step 5d, ADR-071)

Revision ID: a3c7e9f1b5d2
Revises: e7a1c5d9b3f2
Create Date: 2026-11-08 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3c7e9f1b5d2"
down_revision: str | None = "e7a1c5d9b3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # device code of the checkpoint on the sorting line (db-telemetry devices.code, no FK)
    op.add_column("parcel_events", sa.Column("checkpoint", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("parcel_events", "checkpoint")
