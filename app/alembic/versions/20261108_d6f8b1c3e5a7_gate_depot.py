"""the depot of a gate passage (phase 7c, ADR-065)

Revision ID: d6f8b1c3e5a7
Revises: c4e7a9b2d5f1
Create Date: 2026-11-08 06:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d6f8b1c3e5a7"
down_revision: str | None = "c4e7a9b2d5f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("gate_events", sa.Column("depot_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_gate_events_depot_id_depots", "gate_events", "depots", ["depot_id"], ["id"]
    )
    # every passage so far was at the gate of Budimír
    op.execute("UPDATE gate_events SET depot_id = (SELECT id FROM depots WHERE code = 'BUD')")
    op.create_index("ix_gate_events_depot_id", "gate_events", ["depot_id"])


def downgrade() -> None:
    op.drop_index("ix_gate_events_depot_id", table_name="gate_events")
    op.drop_constraint("fk_gate_events_depot_id_depots", "gate_events", type_="foreignkey")
    op.drop_column("gate_events", "depot_id")
