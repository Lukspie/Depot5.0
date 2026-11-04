"""hub in Ivanka pri Dunaji: position, hall and ramps from OSM (phase 5c, ADR-051)

The same values are in seed/reference.py (HUB_*), so a fresh database (this migration + seed)
and an existing one end up equal.

Revision ID: e7f1c3a9b5d2
Revises: d4e8a2b6c1f3
Create Date: 2026-11-04 12:00:00.000000
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e7f1c3a9b5d2"
down_revision: str | None = "d4e8a2b6c1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAME, LAT, LON = "Ivanka pri Dunaji", 48.19404, 17.22834
LAYOUT = {"hall": {"width": 167, "depth": 54, "height": 12, "rotationDeg": 86.1}, "yardGate": [96, -44]}
RAMPS = [(-55.0 + i * 22.0, -27.0) for i in range(6)]

OLD_NAME, OLD_LAT, OLD_LON = "Bratislava hub", 48.16450, 17.17950
OLD_LAYOUT = {"hall": {"width": 64, "depth": 30, "height": 9, "rotationDeg": 0}, "yardGate": [44, -26]}
OLD_RAMPS = [(-25.0 + i * 10.0, -15.0) for i in range(6)]


def _apply(name: str, lat: float, lon: float, layout: dict[str, object], ramps: list[tuple[float, float]]) -> None:
    op.execute(
        sa.text(
            "UPDATE depots SET name = :name, lat = :lat, lon = :lon, layout = CAST(:layout AS jsonb) "
            "WHERE code = 'BAH'"
        ).bindparams(name=name, lat=lat, lon=lon, layout=json.dumps(layout))
    )
    # ramps exist only once the seed has run (existing databases)
    for i, (x, y) in enumerate(ramps):
        op.execute(
            sa.text("UPDATE doors SET position_x = :x, position_y = :y WHERE code = :code").bindparams(
                x=x, y=y, code=f"BA-R{i + 1:02d}"
            )
        )
    # linehaul BA drives to the hub
    op.execute(
        sa.text(
            "UPDATE directions SET dest_lat = :lat, dest_lon = :lon "
            "WHERE destination_depot_id = (SELECT id FROM depots WHERE code = 'BAH')"
        ).bindparams(lat=lat, lon=lon)
    )


def upgrade() -> None:
    _apply(NAME, LAT, LON, LAYOUT, RAMPS)


def downgrade() -> None:
    _apply(OLD_NAME, OLD_LAT, OLD_LON, OLD_LAYOUT, OLD_RAMPS)
