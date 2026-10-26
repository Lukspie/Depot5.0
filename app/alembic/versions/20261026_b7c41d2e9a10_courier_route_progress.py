"""courier route progress

Revision ID: b7c41d2e9a10
Revises: e652f4dbafdb
Create Date: 2026-10-26 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7c41d2e9a10"
down_revision: str | None = "e652f4dbafdb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("courier_routes", sa.Column("departed_at", sa.DateTime(timezone=True)))
    op.add_column("courier_routes", sa.Column("returned_at", sa.DateTime(timezone=True)))
    op.create_index(op.f("ix_courier_routes_date"), "courier_routes", ["date"], unique=False)
    op.create_index(
        op.f("ix_customer_notifications_created_at"),
        "customer_notifications",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_customer_notifications_created_at"), table_name="customer_notifications")
    op.drop_index(op.f("ix_courier_routes_date"), table_name="courier_routes")
    op.drop_column("courier_routes", "returned_at")
    op.drop_column("courier_routes", "departed_at")
