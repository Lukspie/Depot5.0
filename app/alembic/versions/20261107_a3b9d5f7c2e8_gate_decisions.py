"""gate passages, decisions, their audit and the allowed external plates (ADR-061)

Revision ID: a3b9d5f7c2e8
Revises: f2a6c8e4d1b7
Create Date: 2026-11-07 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3b9d5f7c2e8"
down_revision: str | None = "f2a6c8e4d1b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "gate_allowed_plates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("plate", sa.String(16), nullable=False),
        sa.Column("holder", sa.String(120), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name="fk_gate_allowed_plates_created_by_users"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_gate_allowed_plates"),
        sa.UniqueConstraint("plate", name="uq_gate_allowed_plates_plate"),
    )
    op.create_table(
        "gate_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("external_key", sa.String(80), nullable=True),
        sa.Column("direction", sa.String(3), nullable=False),
        sa.Column("vehicle_type", sa.String(8), nullable=True),
        sa.Column("vehicle_confidence", sa.Float(), nullable=True),
        sa.Column("plate", sa.String(16), nullable=True),
        sa.Column("plate_confidence", sa.Float(), nullable=True),
        sa.Column("vehicle_id", sa.Integer(), nullable=True),
        sa.Column("allowed_plate_id", sa.Integer(), nullable=True),
        sa.Column("decision", sa.String(12), nullable=False),
        sa.Column("reason", sa.String(40), nullable=False),
        sa.Column("resolution", sa.String(10), nullable=True),
        sa.Column("resolved_by", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["vehicle_id"], ["vehicles.id"], name="fk_gate_events_vehicle_id_vehicles"
        ),
        sa.ForeignKeyConstraint(
            ["allowed_plate_id"],
            ["gate_allowed_plates.id"],
            name="fk_gate_events_allowed_plate_id_gate_allowed_plates",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"], ["users.id"], name="fk_gate_events_resolved_by_users"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_gate_events"),
        sa.UniqueConstraint("external_key", name="uq_gate_events_external_key"),
    )
    op.create_index("ix_gate_events_at", "gate_events", ["at"])
    op.create_index("ix_gate_events_plate", "gate_events", ["plate"])
    op.create_index("ix_gate_events_open", "gate_events", ["resolution", "decision"])
    op.create_table(
        "gate_audit",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(12), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["gate_events.id"],
            name="fk_gate_audit_event_id_gate_events",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], name="fk_gate_audit_actor_id_users"),
        sa.PrimaryKeyConstraint("id", name="pk_gate_audit"),
    )
    op.create_index("ix_gate_audit_event_id", "gate_audit", ["event_id"])


def downgrade() -> None:
    op.drop_table("gate_audit")
    op.drop_table("gate_events")
    op.drop_table("gate_allowed_plates")
