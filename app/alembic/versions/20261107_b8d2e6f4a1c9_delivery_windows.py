"""kind of delivery and time window of a parcel (ADR-062)

Existing parcels get the same profile as new ones: services/routing.py delivery_profile, md5 of the
barcode (first 7 hex digits), r = h % 100: < 60 handover with window (h // 100) % 3, < 85 mailbox,
else locker.

Revision ID: b8d2e6f4a1c9
Revises: a3b9d5f7c2e8
Create Date: 2026-11-07 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8d2e6f4a1c9"
down_revision: str | None = "a3b9d5f7c2e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# also run by a test that compares it with delivery_profile in Python
FILL = """
        UPDATE parcels SET
          delivery_type = CASE WHEN s.h % 100 < 60 THEN 'handover'
                               WHEN s.h % 100 < 85 THEN 'mailbox' ELSE 'locker' END,
          window_from = CASE WHEN s.h % 100 < 60
                             THEN (ARRAY[time '08:00', time '10:00', time '12:00'])[(s.h / 100) % 3 + 1]
                        END,
          window_to = CASE WHEN s.h % 100 < 60
                           THEN (ARRAY[time '11:00', time '13:00', time '15:00'])[(s.h / 100) % 3 + 1]
                      END
        FROM (SELECT id, ('x' || substr(md5(barcode), 1, 7))::bit(28)::int AS h FROM parcels) s
        WHERE parcels.id = s.id
        """


def upgrade() -> None:
    op.add_column(
        "parcels",
        sa.Column("delivery_type", sa.String(8), server_default="handover", nullable=False),
    )
    op.add_column("parcels", sa.Column("window_from", sa.Time(), nullable=True))
    op.add_column("parcels", sa.Column("window_to", sa.Time(), nullable=True))
    op.execute(FILL)


def downgrade() -> None:
    op.drop_column("parcels", "window_to")
    op.drop_column("parcels", "window_from")
    op.drop_column("parcels", "delivery_type")
