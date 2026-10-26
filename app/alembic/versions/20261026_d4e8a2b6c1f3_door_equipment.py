"""door equipment: drive and dock equipment (phase 5c, ADR-050)

Revision ID: d4e8a2b6c1f3
Revises: c3d9f1a7b2e4
Create Date: 2026-10-26 23:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4e8a2b6c1f3"
down_revision: str | None = "c3d9f1a7b2e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DRIVE = postgresql.ENUM("electric", "manual", name="door_drive")
EQUIPMENT = postgresql.ENUM("dock_leveler", "telescopic_conveyor", "none", name="dock_equipment")

# temporary layout until the real Budimír one (plan-doplnky 5c); also in seed/reference.py
UPDATES = [
    ("electric", "dock_leveler", ["LD-01", "LD-02"] + [f"BA-R0{i}" for i in range(1, 7)]),
    ("electric", "telescopic_conveyor", ["LD-03", "LD-04", "LD-05"]),
    ("manual", "none", [f"SB-0{i}" for i in range(1, 9)]),
]


def upgrade() -> None:
    DRIVE.create(op.get_bind(), checkfirst=True)
    EQUIPMENT.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "doors", sa.Column("door_drive", DRIVE, nullable=False, server_default="electric")
    )
    op.add_column(
        "doors", sa.Column("dock_equipment", EQUIPMENT, nullable=False, server_default="none")
    )
    for drive, equipment, codes in UPDATES:
        op.execute(
            sa.text(
                "UPDATE doors SET door_drive = CAST(:d AS door_drive), "
                "dock_equipment = CAST(:e AS dock_equipment) WHERE code = ANY(:codes)"
            ).bindparams(d=drive, e=equipment, codes=codes)
        )


def downgrade() -> None:
    op.drop_column("doors", "dock_equipment")
    op.drop_column("doors", "door_drive")
    EQUIPMENT.drop(op.get_bind(), checkfirst=True)
    DRIVE.drop(op.get_bind(), checkfirst=True)
