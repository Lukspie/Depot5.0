"""maintenance orders (phase 5, ADR-048)

Revision ID: c3d9f1a7b2e4
Revises: b7c41d2e9a10
Create Date: 2026-10-26 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3d9f1a7b2e4"
down_revision: str | None = "b7c41d2e9a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "maintenance_orders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_code", sa.String(length=32), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("until", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_maintenance_orders_device_code"), "maintenance_orders", ["device_code"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_maintenance_orders_device_code"), table_name="maintenance_orders")
    op.drop_table("maintenance_orders")
