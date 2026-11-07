"""Gate decisions (ADR-061): the model recommends, rules decide, security decides when unsure.

The image only gives the vehicle type and the plate text. Who the vehicle is comes from the plate:
the fleet (`vehicles`) or the allowed external plates. Every decision goes to `gate_audit`.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from depotrack.core.config import get_settings
from depotrack.models import Alert, GateAllowedPlate, GateAudit, GateEvent, User, Vehicle
from depotrack.models.enums import AlertKind, AlertSeverity
from depotrack.services.alerts import AlertChange, day_start, resolve_alert, upsert_alert

AUTO_PASS, PASS_VERIFY, HOLD = "auto_pass", "pass_verify", "hold"
ALLOWED, DENIED, VERIFIED, EXPIRED = "allowed", "denied", "verified", "expired"
# what security may do with an open event of each decision
ACTIONS: dict[str, dict[str, str]] = {
    HOLD: {"allow": ALLOWED, "deny": DENIED},
    PASS_VERIFY: {"verify": VERIFIED},
}
TYPE_SK = {"car": "osobné auto", "van": "dodávka", "truck": "kamión", "bus": "autobus"}
SYSTEM_NOTE = {
    "fleet_vehicle": "vozidlo vozového parku",
    "allowed_plate": "povolená externá ŠPZ",
    "exit_after_entry": "odchod vozidla, ktoré dnes vošlo s povolením",
    "truck_unknown_plate": "kamión s neznámou ŠPZ, prejazd povolený, overiť",
    "truck_no_plate": "kamión s neprečítanou ŠPZ, prejazd povolený, overiť",
    "low_vehicle_confidence": "nízka istota modelu typu vozidla",
    "low_plate_confidence": "nízka istota čítania ŠPZ",
    "unknown_plate": "ŠPZ nie je v databáze",
    "no_plate": "ŠPZ sa nepodarilo prečítať",
}


@dataclass(frozen=True)
class Reading:
    direction: Literal["in", "out"]
    vehicle_type: str | None
    vehicle_confidence: float | None
    plate: str | None
    plate_confidence: float | None


@dataclass(frozen=True)
class Verdict:
    decision: str
    reason: str
    vehicle: Vehicle | None
    allowed: GateAllowedPlate | None


def decide(db: Session, r: Reading, at: datetime) -> Verdict:
    """The rules, in this order: low confidence -> security; known plate -> pass; lorry ->
    pass and verify; anything else unknown -> wait for security."""
    s = get_settings()
    vehicle = allowed = None
    if r.plate:
        vehicle = db.execute(select(Vehicle).where(Vehicle.plate == r.plate)).scalar_one_or_none()
        allowed = db.execute(
            select(GateAllowedPlate).where(
                GateAllowedPlate.plate == r.plate,
                or_(
                    GateAllowedPlate.valid_until.is_(None),
                    GateAllowedPlate.valid_until >= at.date(),
                ),
            )
        ).scalar_one_or_none()

    def verdict(decision: str, reason: str) -> Verdict:
        return Verdict(decision, reason, vehicle, allowed)

    if r.vehicle_type is not None and (r.vehicle_confidence or 0.0) < s.gate_min_vehicle_confidence:
        return verdict(HOLD, "low_vehicle_confidence")
    if r.plate is not None and (r.plate_confidence or 0.0) < s.gate_min_plate_confidence:
        return verdict(HOLD, "low_plate_confidence")
    if vehicle is not None:
        return verdict(AUTO_PASS, "fleet_vehicle")
    if allowed is not None:
        return verdict(AUTO_PASS, "allowed_plate")
    if r.direction == "out" and r.plate and _entered_today(db, r.plate, at):
        return verdict(AUTO_PASS, "exit_after_entry")
    if r.vehicle_type == "truck":
        return verdict(PASS_VERIFY, "truck_unknown_plate" if r.plate else "truck_no_plate")
    return verdict(HOLD, "unknown_plate" if r.plate else "no_plate")


def _entered_today(db: Session, plate: str, at: datetime) -> bool:
    """The vehicle came in during the last 24 h and was let in (rules or security)."""
    return (
        db.execute(
            select(GateEvent.id).where(
                GateEvent.plate == plate,
                GateEvent.direction == "in",
                GateEvent.at >= at - timedelta(hours=24),
                GateEvent.at <= at,
                or_(
                    GateEvent.decision.in_((AUTO_PASS, PASS_VERIFY)),
                    GateEvent.resolution == ALLOWED,
                ),
            )
        ).first()
        is not None
    )


def record(
    db: Session, r: Reading, *, at: datetime, source: str, external_key: str | None = None
) -> tuple[GateEvent, AlertChange | None] | None:
    """Decide and store one passage with its audit row; None if the key was already stored.
    A held vehicle also raises an alert for the dispatch (closed when security decides)."""
    v = decide(db, r, at)
    values: dict[str, Any] = {
        "at": at,
        "source": source,
        "external_key": external_key,
        "direction": r.direction,
        "vehicle_type": r.vehicle_type,
        "vehicle_confidence": r.vehicle_confidence,
        "plate": r.plate,
        "plate_confidence": r.plate_confidence,
        "vehicle_id": v.vehicle.id if v.vehicle else None,
        "allowed_plate_id": v.allowed.id if v.allowed else None,
        "decision": v.decision,
        "reason": v.reason,
    }
    event_id = db.execute(
        insert(GateEvent)
        .values(**values)
        .on_conflict_do_nothing(index_elements=["external_key"])
        .returning(GateEvent.id)
    ).scalar_one_or_none()
    if event_id is None:
        return None
    event = db.get_one(GateEvent, event_id)
    db.add(GateAudit(event_id=event.id, at=at, actor_id=None, action=v.decision, reason=v.reason))
    alert = None
    if v.decision == HOLD:
        alert = upsert_alert(
            db,
            kind=AlertKind.OTHER,
            severity=AlertSeverity.WARNING,
            message=f"Brána: {describe(event)} čaká na rozhodnutie ochranky "
            f"({SYSTEM_NOTE[v.reason]})",
            ref_type="gate",
            ref_id=str(event.id),
            at=at,
        )
    db.flush()
    return event, alert


def describe(e: GateEvent) -> str:
    kind = TYPE_SK.get(e.vehicle_type or "", "vozidlo")
    return f"{kind} {e.plate}" if e.plate else f"{kind} bez ŠPZ"


class GateDecisionError(ValueError):
    pass


def resolve(
    db: Session, event: GateEvent, user: User, action: str, note: str, at: datetime
) -> Alert | None:
    """Security decides an open event; the note is the reason in the audit. Returns the alert of
    a held vehicle, now closed."""
    if event.resolution is not None:
        raise GateDecisionError("already decided")
    resolution = ACTIONS.get(event.decision, {}).get(action)
    if resolution is None:
        raise GateDecisionError(f"action {action} not possible for {event.decision}")
    event.resolution = resolution
    event.resolved_by = user.id
    event.resolved_at = at
    event.note = note
    db.add(GateAudit(event_id=event.id, at=at, actor_id=user.id, action=resolution, reason=note))
    return resolve_alert(db, kind=AlertKind.OTHER, ref_type="gate", ref_id=str(event.id), at=at)


def close_stale_events(db: Session, day: Any) -> int:
    """Open events of days before the previous operating day are closed by the system
    (kept for the audit), like the alerts (phase 5d)."""
    cutoff = day_start(day - timedelta(days=1))
    ids = list(
        db.execute(
            select(GateEvent.id).where(
                GateEvent.resolution.is_(None),
                GateEvent.decision != AUTO_PASS,
                GateEvent.at < cutoff,
            )
        ).scalars()
    )
    if not ids:
        return 0
    db.execute(
        update(GateEvent)
        .where(GateEvent.id.in_(ids))
        .values(resolution=EXPIRED, resolved_at=cutoff, note="uzavreté systémom na konci dňa")
    )
    db.add_all(
        GateAudit(event_id=i, at=cutoff, actor_id=None, action=EXPIRED, reason="end of day")
        for i in ids
    )
    return len(ids)


def delete_day(db: Session, start: datetime, end: datetime) -> int:
    """Reset of an operating day: its passages go (the replay sends the simulated ones again)."""
    result = db.execute(delete(GateEvent).where(GateEvent.at >= start, GateEvent.at < end))
    return int(getattr(result, "rowcount", 0) or 0)
