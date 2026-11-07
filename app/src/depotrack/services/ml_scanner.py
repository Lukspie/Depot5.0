"""Risk scores of the dock scanners and the "check the optics" alert (phase 6, ADR-058).

Every 5 simulated minutes the job takes the 10-minute buckets of each dock scanner from telematics
(db-telemetry may be in Azure, ADR-056), scores the latest one and keeps the result in memory for
the digital shadow. At the threshold it opens a `scanner_degradation` alert for the device; below
half the threshold (hysteresis) it closes it again.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from depotrack.ml.scanner import Bucket, ScannerModel, bucket_features
from depotrack.models.enums import AlertKind, AlertSeverity
from depotrack.services.alerts import AlertChange, resolve_alert, upsert_alert

REF = "device"
# below this risk an open alert closes again (no flapping around the threshold)
CLOSE_BELOW = 0.5


@dataclass(frozen=True)
class ScannerRisk:
    device: str
    door_code: str | None
    risk: float | None  # None = idle (too few items in 30 min)
    score: float | None
    alarm: bool
    rate_30m: float | None
    rate_2h: float | None
    at: datetime


# latest result per device, for GET /api/ml/scanners (one app process, ADR-057)
LATEST: dict[str, ScannerRisk] = {}


def to_buckets(rows: list[dict[str, Any]]) -> list[Bucket]:
    """Telematics buckets ({at, items, readRate}) -> counts, oldest first."""
    out = []
    for r in rows:
        items = int(r.get("items") or 0)
        rate = r.get("readRate")
        out.append(Bucket(items, round(items * float(rate)) if items and rate is not None else 0))
    return out


def score_scanners(
    db: Session,
    model: ScannerModel,
    devices: list[dict[str, Any]],
    metrics_of: Callable[[str], list[dict[str, Any]] | None],
    now: datetime,
) -> list[AlertChange]:
    changes: list[AlertChange] = []
    for d in devices:
        if d.get("kind") != "dock_scanner":  # line scanner differs, door sensors never scan
            continue
        code = str(d["code"])
        door = d.get("doorCode")
        rows = metrics_of(code)
        buckets = to_buckets(rows) if rows else []
        f = bucket_features(buckets)
        if f is None:
            LATEST[code] = ScannerRisk(code, door, None, None, False, None, None, now)
            continue
        score = model.score(f)
        risk = model.risk(score)
        alarm = model.alarm(buckets)
        LATEST[code] = ScannerRisk(code, door, risk, score, alarm, f.rate_30m, f.rate_2h, now)
        if alarm:
            changes.append(
                upsert_alert(
                    db,
                    kind=AlertKind.SCANNER_DEGRADATION,
                    severity=AlertSeverity.WARNING,
                    message=(
                        f"Skener brány {door or code} – klesajúca čítanosť "
                        f"({f.rate_30m * 100:.1f} %), skontrolovať optiku".replace(".", ",")
                    ),
                    ref_type=REF,
                    ref_id=code,
                    at=now,
                )
            )
        elif risk < CLOSE_BELOW:
            resolve_alert(db, kind=AlertKind.SCANNER_DEGRADATION, ref_type=REF, ref_id=code, at=now)
    return changes
