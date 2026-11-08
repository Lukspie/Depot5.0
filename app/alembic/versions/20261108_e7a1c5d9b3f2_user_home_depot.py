"""home depot of a user (phase 7d, ADR-068)

Revision ID: e7a1c5d9b3f2
Revises: d6f8b1c3e5a7
Create Date: 2026-11-08 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7a1c5d9b3f2"
down_revision: str | None = "d6f8b1c3e5a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("home_depot_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_home_depot_id_depots", "users", "depots", ["home_depot_id"], ["id"]
    )
    # the seed step "users-home-depot" fills it in (couriers of Žilina and Ivanka by username)


def downgrade() -> None:
    op.drop_constraint("fk_users_home_depot_id_depots", "users", type_="foreignkey")
    op.drop_column("users", "home_depot_id")
