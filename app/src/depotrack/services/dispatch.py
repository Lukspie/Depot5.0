"""Dispatching of one depot (phase 7d, maketa-dispecing).

A transshipment depot (with its own linehaul directions, Budimír) has waves, evening linehaul
departures and morning transit departures. A delivery depot (Žilina, Ivanka) gets its parcels on
a feeder truck and delivers them with its couriers. Both get the same page: KPIs with a history
since 15:00, trips in groups, structured alerts, parcels per direction and the day's timeline,
only the content differs (no empty waves or zero cards where they do not belong).
"""

from bisect import bisect_right
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from depotrack.core.clock import local_hhmm
from depotrack.core.config import get_settings
from depotrack.ml.scanner import scanner_model
from depotrack.models import (
    Alert,
    CourierRoute,
    Depot,
    Direction,
    GateEvent,
    LoadingScan,
    Parcel,
    ParcelEvent,
    RouteStop,
    Trip,
    Wave,
)
from depotrack.models.enums import (
    AlertKind,
    AlertSeverity,
    DirectionType,
    DoorKind,
    ParcelStatus,
    ScanResult,
    StopOutcome,
    TripKind,
    TripStatus,
)
from depotrack.schemas.dispatch import (
    AlertAction,
    AlertCard,
    Delta,
    DirectionBar,
    DispatchDepot,
    DispatchOut,
    KpiOut,
    Risk,
    TimelineSegment,
    Tone,
    TripGroup,
    TripRow,
)
from depotrack.services import ml_scanner
from depotrack.services.alerts import current_alerts, day_start
from depotrack.services.cascade import cascade_risk, expected_arrival
from depotrack.services.depot_scope import alerts_of_depot
from depotrack.services.kpis import DELIVERY, day_overview, day_read_rate
from depotrack.services.loading import trip_load_stats
from depotrack.services.parcels import in_day
from depotrack.services.views import Lookup, clock, trips_of

STEP = timedelta(minutes=30)
FAR = datetime(9999, 1, 1, tzinfo=UTC)
KIND = {
    DirectionType.LINEHAUL: "diaľkový",
    DirectionType.TRANSIT: "prechod",
    DirectionType.LOCAL: "rajón",
}


# ------------------------------------------------------------------ formats (sk)


def num(n: float) -> str:
    return f"{n:,.0f}".replace(",", " ")


def dec(v: float, places: int = 1) -> str:
    return f"{v:.{places}f}".replace(".", ",")


def share(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


def signed_min(m: int) -> str:
    return "0 min" if m == 0 else f"{'+' if m > 0 else '−'}{abs(m)} min"


# ------------------------------------------------------------------ history


def day_window(day: date) -> tuple[datetime, datetime]:
    """The operating day 15:00 → 15:00 (ADR-022), not the parcel window of services.parcels."""
    start = day_start(day)
    return start, start + timedelta(days=1)


def points(day: date, now: datetime) -> list[datetime]:
    """Every 30 min since 15:00 of the operating day up to now (the last point is now)."""
    start, end = day_window(day)
    out = []
    t = start + STEP
    while t < min(now, end):
        out.append(t)
        t += STEP
    return [*out, min(now, end)]


def cumulative(times: list[datetime], at: list[datetime]) -> list[float]:
    times = sorted(times)
    return [float(bisect_right(times, t)) for t in at]


def open_at(spans: list[tuple[datetime, datetime | None]], at: list[datetime]) -> list[float]:
    return [float(sum(1 for a, b in spans if a <= t and (b is None or b > t))) for t in at]


# ------------------------------------------------------------------ alerts


def _alert_card(db: Session, a: Alert, look: Lookup, depot: Depot) -> AlertCard:
    """Type, time, one sentence, facts as chips and the action of an alert, from the data it
    refers to (the message stays the fallback)."""
    title, facts, source, action = a.message, [], None, None
    ref = a.ref_id or ""
    buffer = timedelta(minutes=get_settings().cascade_buffer_min)
    if a.ref_type == "cascade" and ":" in ref:
        transit = db.get(Trip, int(ref.split(":")[0]))
        night = db.get(Trip, int(ref.split(":")[1]))
        eta = expected_arrival(night) if night else None
        if transit and night and eta and transit.planned_departure:
            risk = cascade_risk(eta, transit.planned_departure, buffer)
            late = risk.late_min if risk else 0
            title = (
                f"Prechod {look.directions[transit.direction_id].name} odíde o ~{late} min neskôr"
            )
            facts = [
                f"nočný {look.directions[night.direction_id].code} príde {local_hhmm(eta)}",
                f"triedenie {buffer.seconds // 60} min",
                f"odchod {local_hhmm(transit.planned_departure)} → "
                f"{local_hhmm(transit.planned_departure + timedelta(minutes=late))}",
            ]
            source = "ML predikcia" if night.predicted_by == "ml" else "telematika"
            action = AlertAction(
                label="Otvoriť scenár",
                kind="scenario",
                target=f"/shadow?depot={depot.code}&scenario=1",
            )
    elif a.ref_type == "parcel":
        parcel = db.execute(select(Parcel).where(Parcel.barcode == ref)).scalar_one_or_none()
        scan = (
            db.execute(
                select(LoadingScan)
                .where(
                    LoadingScan.parcel_id == parcel.id,
                    LoadingScan.result == ScanResult.WRONG_DIRECTION,
                )
                .order_by(LoadingScan.at.desc())
                .limit(1)
            ).scalar_one_or_none()
            if parcel
            else None
        )
        if parcel and scan:
            trip = db.get_one(Trip, scan.trip_id)
            door = look.doors[scan.door_id].code
            title = (
                f"Balík pre {look.directions[parcel.direction_id].name} naložený do kamióna na "
                f"{look.directions[trip.direction_id].name}"
            )
            plate = look.vehicles[trip.vehicle_id].plate
            left = (
                f"odišiel {local_hhmm(trip.actual_departure)}"
                if trip.actual_departure
                else f"brána {door}"
            )
            facts = [parcel.barcode, plate, left]
            source = door
            action = AlertAction(label="Detail balíka", kind="link", target=f"/parcels/{parcel.id}")
    elif a.ref_type == "device":
        scanner = ml_scanner.LATEST.get(ref)
        door_code = scanner.door_code if scanner else None
        title = f"{ref} pri {door_code} stráca čítanosť" if door_code else f"{ref} stráca čítanosť"
        if scanner and scanner.rate_30m is not None:
            facts.append(f"čítanosť {dec(scanner.rate_30m * 100, 0)} %")
        if scanner and scanner.risk is not None:
            facts.append(f"riziko poruchy {dec(scanner.risk, 2)}")
        nxt = _next_trip_at(db, door_code, look) if door_code else None
        if nxt:
            facts.append(nxt)
        source = "IsolationForest"
        action = AlertAction(label="Poslať na údržbu", kind="maintenance", target=ref)
    elif a.ref_type == "gate":
        source = "brána"
    return AlertCard(
        id=a.id,
        kind=a.kind,
        severity=a.severity,
        at=a.created_at,
        source=source,
        title=title,
        facts=facts,
        action=action,
    )


def _next_trip_at(db: Session, door_code: str, look: Lookup) -> str | None:
    door = next((d for d in look.doors.values() if d.code == door_code), None)
    if door is None:
        return None
    trip = db.execute(
        select(Trip)
        .where(
            Trip.door_id == door.id,
            Trip.status.in_((TripStatus.PLANNED, TripStatus.AT_DOOR, TripStatus.LOADING)),
        )
        .order_by(Trip.planned_departure)
        .limit(1)
    ).scalar_one_or_none()
    if trip is None or trip.planned_arrival is None:
        return None
    return f"nakládka {look.directions[trip.direction_id].code} {local_hhmm(trip.planned_arrival)}"


def _alert_kpi(alerts_now: list[Alert], spark: list[float]) -> KpiOut:
    critical = sum(1 for a in alerts_now if a.severity == AlertSeverity.CRITICAL)
    kinds = Counter(a.kind for a in alerts_now)
    names = {
        AlertKind.CASCADE_DELAY: "kaskáda",
        AlertKind.WRONG_DIRECTION: "zlý smer",
        AlertKind.SCANNER_DEGRADATION: "skener",
        AlertKind.DEVICE_OFFLINE: "zariadenie",
        AlertKind.OTHER: "brána",
    }
    return KpiOut(
        key="alerts",
        label="Alarmy",
        tone="danger",
        value=num(len(alerts_now)),
        unit="aktívnych" if len(alerts_now) != 1 else "aktívny",
        spark=spark,
        delta=Delta(value=f"{critical} kritické", tone="danger") if critical else None,
        context=" · ".join(names[k] for k, _ in kinds.most_common(3)) or "všetko beží podľa plánu",
    )


def _alerts(
    db: Session, depot: Depot, day: date, at: list[datetime]
) -> tuple[list[Alert], list[float]]:
    """Open alerts of the depot now, and how many were open at each point of the day."""
    of_day = list(
        db.execute(
            select(Alert).where(current_alerts(day)).order_by(Alert.created_at.desc())
        ).scalars()
    )
    mine = alerts_of_depot(db, of_day, depot, unplaced=True)
    spans = [(a.created_at, a.acknowledged_at) for a in mine]
    now_open = [a for a in mine if a.acknowledged_at is None]
    return now_open, open_at(spans, at)


# ------------------------------------------------------------------ transshipment depot


def _transship(db: Session, depot: Depot, look: Lookup) -> DispatchOut:
    clk = clock()
    day, now = clk.operating_day, clk.sim_time
    at = points(day, now)
    trips = [t for t in trips_of(db, day) if t.depot_id == depot.id]
    kpis_old, rows = day_overview(db, day, trips, look, now, depot.id)
    own_dirs = [d.id for d in look.directions.values() if d.depot_id == depot.id]

    created = list(
        db.execute(
            select(Parcel.created_at).where(in_day(day), Parcel.direction_id.in_(own_dirs))
        ).scalars()
    )
    loaded_events = list(
        db.execute(
            select(func.min(ParcelEvent.at))
            .join(Parcel, Parcel.id == ParcelEvent.parcel_id)
            .where(
                ParcelEvent.status == ParcelStatus.LOADED,
                in_day(day),
                Parcel.direction_id.in_(own_dirs),
            )
            .group_by(ParcelEvent.parcel_id)
        ).scalars()
    )
    parcels_spark = cumulative(created, at)
    hour_ago = parcels_spark[-3] if len(parcels_spark) >= 3 else 0.0
    # trucks at the doors: outbound trips between the arrival at the door and the departure
    spans = [
        (t.actual_arrival, t.actual_departure)
        for t in trips
        if t.kind == TripKind.OUTBOUND and t.actual_arrival is not None
    ]
    at_door = [t for t in trips if t.status in (TripStatus.AT_DOOR, TripStatus.LOADING)]
    docks = sum(
        1 for d in look.doors.values() if d.depot_id == depot.id and d.kind == DoorKind.LOADING_DOCK
    )
    scans = db.execute(
        select(LoadingScan.at, LoadingScan.result)
        .join(Trip, LoadingScan.trip_id == Trip.id)
        .where(Trip.operating_day == day, Trip.depot_id == depot.id)
    ).all()
    rate_spark = []
    for t in at:
        window = [r for a, r in scans if t - timedelta(hours=1) < a <= t]
        if window:
            rate_spark.append(
                round(
                    100
                    * (1 - sum(1 for r in window if r == ScanResult.UNIDENTIFIED) / len(window)),
                    1,
                )
            )
        else:
            rate_spark.append(rate_spark[-1] if rate_spark else 100.0)
    rate = day_read_rate(db, day)
    worst = min(
        (r for r in ml_scanner.LATEST.values() if r.rate_30m is not None and r.door_code),
        key=lambda r: r.rate_30m or 1.0,
        default=None,
    )
    model = scanner_model()
    degrading = (
        worst if worst and model and (worst.alarm or (worst.risk or 0) >= model.threshold) else None
    )
    rate_change = rate_spark[-1] - rate_spark[-3] if len(rate_spark) >= 3 else 0.0
    alerts_now, alert_spark = _alerts(db, depot, day, at)
    first = at_door[0] if at_door else None

    kpis = [
        KpiOut(
            key="parcels",
            label="Balíky dňa",
            tone="brand",
            value=num(kpis_old.parcels_total),
            spark=parcels_spark,
            delta=Delta(value=f"+{num(parcels_spark[-1] - hour_ago)}", tone="ok")
            if parcels_spark[-1] > hour_ago
            else None,
            context=f"{num(kpis_old.parcels_waiting)} čaká na triedenie",
        ),
        KpiOut(
            key="loaded",
            label="Naložené",
            tone="brand",
            value=num(kpis_old.parcels_loaded),
            unit=f"/ {num(kpis_old.parcels_total)}",
            spark=cumulative(loaded_events, at),
            delta=Delta(
                value=f"{share(kpis_old.parcels_loaded, kpis_old.parcels_total)} %",
                tone="neutral",
            ),
            context=f"{num(kpis_old.parcels_missing)} nenaložených",
        ),
        KpiOut(
            key="trucks",
            label="Kamióny pri bránach",
            tone="info",
            value=num(len(at_door)),
            unit=f"/ {docks} brán",
            spark=open_at(spans, at),
            delta=Delta(value=look.doors[first.door_id].code, tone="info")
            if first and first.door_id
            else None,
            context=(
                f"{KIND.get(look.directions[first.direction_id].type, '')} "
                f"{look.directions[first.direction_id].code} "
                f"{'vykladá' if first.kind == TripKind.INBOUND else 'nakladá'}"
                if first
                else "žiadny kamión pri bráne"
            ),
        ),
        KpiOut(
            key="read",
            label="Čítanosť skenerov",
            tone="warn" if degrading else "ok",
            value=dec(rate * 100) if rate is not None else "—",
            unit="%" if rate is not None else None,
            spark=rate_spark,
            delta=Delta(
                value=f"{'↓' if rate_change < 0 else '↑'} {dec(abs(rate_change))}",
                tone="warn" if rate_change < 0 else "ok",
            )
            if abs(rate_change) >= 0.1
            else None,
            context=f"{degrading.door_code} degraduje" if degrading else "skenery v poriadku",
        ),
        _alert_kpi(alerts_now, alert_spark),
    ]

    # trips: evening linehaul departures, morning transit departures; arrivals likewise
    groups = [
        TripGroup(
            key="lh-out", tab="out", title="Večerné diaľkové odchody", sub="", tone="neutral"
        ),
        TripGroup(
            key="tr-out",
            tab="out",
            title="Ranné prechody",
            sub="· nakládka po nočnej vlne",
            tone="brand",
        ),
        TripGroup(
            key="tr-in", tab="in", title="Popoludňajšie príchody prechodov", sub="", tone="neutral"
        ),
        TripGroup(
            key="lh-in",
            tab="in",
            title="Nočné diaľkové príchody",
            sub="· prekládka do ranných prechodov",
            tone="brand",
        ),
    ]
    cascade = _cascade_risks(db, trips, look)
    risky_doors = {
        r.door_code: r
        for r in ml_scanner.LATEST.values()
        if r.door_code and model and (r.alarm or (r.risk or 0) >= model.threshold)
    }
    rows_out = [
        _trip_row(db, t, look, now, cascade, risky_doors, depot)
        for t in sorted(trips, key=_plan_of)
    ]
    for g in groups:
        mine = [r for r in rows_out if r.group == g.key]
        done = sum(
            1
            for r in mine
            if r.status in (TripStatus.DEPARTED, TripStatus.EN_ROUTE, TripStatus.COMPLETED)
        )
        if g.key.endswith("out") and done:
            g.sub = f"· {done} odišli" if g.key == "lh-out" else g.sub
        if g.key.endswith("in"):
            g.sub = g.sub or f"· {done} prišli"
    departed_lh = sum(1 for r in rows_out if r.group == "lh-out" and r.missing is not None)
    waiting_tr = sum(1 for r in rows_out if r.group == "tr-out" and r.status == TripStatus.PLANNED)

    # parcels per direction: the courier districts of a town in one bar (as in the mockup)
    bars: list[DirectionBar] = []
    local = [r for r in rows if r.type == DirectionType.LOCAL]
    if local:
        town = local[0].name.split(" – ")[0]
        bars.append(
            DirectionBar(
                name=f"{town} – kuriéri",
                parts=[
                    sum(r.loaded for r in local),
                    sum(r.staged for r in local),
                    sum(r.waiting for r in local),
                ],
                total=sum(r.total for r in local),
            )
        )
    bars += [
        DirectionBar(name=r.name, parts=[r.loaded, r.staged, r.waiting], total=r.total)
        for r in rows
        if r.type != DirectionType.LOCAL and r.total
    ]
    bars.sort(key=lambda b: -b.total)
    legend_totals = [sum(b.parts[i] for b in bars) for i in range(3)]

    timeline = _transship_timeline(db, depot, day, now, trips, look)
    start, _ = day_window(day)
    return DispatchOut(
        depot=_depot_out(depot, look, "transship"),
        clock=clk,
        summary=(
            f"{departed_lh} diaľkové odchody hotové, {waiting_tr} ranných prechodov pred nakládkou"
        ),
        kpis=kpis,
        groups=groups,
        trips=rows_out,
        alerts=[_alert_card(db, a, look, depot) for a in alerts_now],
        legend=["Naložené", "Odstavené", "Čaká"],
        legend_totals=legend_totals,
        directions=bars,
        day_start=start,
        timeline=timeline,
    )


def _plan_of(t: Trip) -> datetime:
    return (t.planned_departure if t.kind == TripKind.OUTBOUND else t.planned_arrival) or FAR


def _cascade_risks(
    db: Session, trips: list[Trip], look: Lookup
) -> dict[int, tuple[int, Tone, str]]:
    """Transit trip id -> (minutes late, tone, reason) from the night trucks that feed it."""
    buffer = timedelta(minutes=get_settings().cascade_buffer_min)
    night = [
        t
        for t in trips
        if t.kind == TripKind.INBOUND
        and look.directions[t.direction_id].type == DirectionType.LINEHAUL
    ]
    out: dict[int, tuple[int, Tone, str]] = {}
    for t in trips:
        d = look.directions[t.direction_id]
        if (
            t.kind != TripKind.OUTBOUND
            or d.type != DirectionType.TRANSIT
            or t.planned_departure is None
        ):
            continue
        for n in night:
            feeder = look.directions[n.direction_id]
            eta = expected_arrival(n)
            if feeder.code not in (d.depends_on_linehaul or []) or eta is None:
                continue
            risk = cascade_risk(eta, t.planned_departure, buffer)
            if risk and risk.late_min > out.get(t.id, (0, "warn", ""))[0]:
                tone: Tone = (
                    "danger"
                    if risk.severity == AlertSeverity.CRITICAL or risk.late_min > 15
                    else "warn"
                )
                out[t.id] = (risk.late_min, tone, f"nočný {feeder.code} príde {local_hhmm(eta)}")
    return out


STATUS: dict[TripStatus, tuple[str, Tone, str]] = {
    TripStatus.PLANNED: ("Plánovaná", "neutral", "plain"),
    TripStatus.AT_DOOR: ("Pri bráne", "info", ""),
    TripStatus.LOADING: ("Nakladá sa", "ok", ""),
    TripStatus.DEPARTED: ("Odišiel", "neutral", ""),
    TripStatus.EN_ROUTE: ("Na ceste", "info", ""),
    TripStatus.COMPLETED: ("Dokončená", "neutral", ""),
    TripStatus.CANCELLED: ("Zrušená", "danger", ""),
}


def _trip_row(
    db: Session,
    t: Trip,
    look: Lookup,
    now: datetime,
    cascade: dict[int, tuple[int, Tone, str]],
    risky_doors: dict[str, ml_scanner.ScannerRisk],
    depot: Depot,
) -> TripRow:
    d = look.directions[t.direction_id]
    door = look.doors[t.door_id].code if t.door_id else None
    out = t.kind == TripKind.OUTBOUND
    plan = t.planned_departure if out else t.planned_arrival
    loaded = expected = 0
    missing = None
    if out:
        s = trip_load_stats(db, t)
        loaded, expected = s.loaded, s.expected
        if t.actual_departure is not None:
            missing = max(0, expected - loaded)
    eta, eta_by = (t.actual_departure, None) if out else (expected_arrival(t), t.predicted_by)
    risk = None
    if out and t.id in cascade and t.actual_departure is None:
        late, tone, reason = cascade[t.id]
        eta, eta_by = (
            (t.planned_departure + timedelta(minutes=late) if t.planned_departure else None),
            "cascade",
        )
        risk = Risk(label="Kaskáda", tone=tone, reason=reason)
    elif out and door in risky_doors and t.actual_departure is None:
        r = risky_doors[door]
        risk = Risk(
            label="Skener",
            tone="warn",
            reason=f"{r.device} čítanosť {dec((r.rate_30m or 0) * 100, 0)} %",
        )
    if eta is None and out:
        eta = plan
    label, tone, _ = STATUS[t.status]
    if t.kind == TripKind.INBOUND and t.status == TripStatus.COMPLETED:
        label = "Prišiel"
    group = ("lh" if d.type == DirectionType.LINEHAUL else "tr") + ("-out" if out else "-in")
    return TripRow(
        key=f"trip-{t.id}",
        group=group,
        kind=t.kind,
        status=t.status,
        status_label=label,
        status_tone=tone,
        plan=plan,
        direction=d.name,
        plate=look.vehicles[t.vehicle_id].plate,
        type_label=KIND.get(d.type, ""),
        door=door,
        loaded=loaded,
        expected=expected,
        missing=missing,
        loading_from=t.planned_arrival if out and t.actual_departure is None else None,
        eta=eta,
        delta_min=int((eta - plan).total_seconds() // 60) if eta and plan else None,
        eta_by=eta_by,
        risk=risk,
        href=f"/shadow?depot={depot.code}&door={door}" if door and out else None,
    )


def _transship_timeline(
    db: Session, depot: Depot, day: date, now: datetime, trips: list[Trip], look: Lookup
) -> list[TimelineSegment]:
    out: list[TimelineSegment] = []
    names = {"evening": "Večerná vlna", "night": "Nočná vlna"}
    waves = db.execute(
        # the waves of the operating day 15:00 → 15:00 (the night wave is on the next date)
        select(Wave)
        .where(
            Wave.depot_id == depot.id,
            Wave.starts_at >= day_window(day)[0],
            Wave.starts_at < day_window(day)[1],
        )
        .order_by(Wave.starts_at)
    ).scalars()
    for w in waves:
        # a finished wave is grey, the running or next one orange (as in the mockup)
        tone: Tone = "neutral" if w.ends_at <= now else "brand"
        out.append(
            _segment(
                names.get(w.kind.value, w.kind.value),
                w.starts_at,
                w.ends_at,
                tone,
                now,
                progress=True,
            )
        )
    transit = sorted(
        (
            t.planned_departure
            for t in trips
            if t.kind == TripKind.OUTBOUND
            and t.planned_departure
            and look.directions[t.direction_id].type == DirectionType.TRANSIT
        ),
    )
    if transit:
        out.append(_segment("Ranné odchody", transit[0], transit[-1], "primary", now))
    routes = (
        db.execute(
            select(CourierRoute)
            .join(Direction, CourierRoute.rajon_direction_id == Direction.id)
            .where(CourierRoute.date == day + timedelta(days=1), Direction.depot_id == depot.id)
        )
        .scalars()
        .all()
    )
    if routes:
        loading = _local(day + timedelta(days=1), 6, 30)
        departure = _local(day + timedelta(days=1), 7, 30)
        seg = _segment("Odchod kuriérov", departure, departure + timedelta(minutes=10), "info", now)
        if now < loading:
            seg.state, seg.state_tone = "nakládka od 06:30", "info"
        out.append(seg)
    return out


def _local(d: date, hh: int, mm: int) -> datetime:
    from depotrack.core.clock import TZ

    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=TZ)


def _segment(
    name: str,
    start: datetime,
    end: datetime,
    tone: Tone | Literal["primary"],
    now: datetime,
    progress: bool = False,
) -> TimelineSegment:
    """A part of the day with its state: done, running (with progress), or in how long."""
    if end <= now:
        state, state_tone = "hotová" if progress else "hotové", "neutral"
    elif start <= now:
        share = round(100 * (now - start) / (end - start))
        state, state_tone = (f"prebieha · {share} %" if progress else "prebieha"), "brand"
    else:
        minutes = int((start - now).total_seconds() // 60)
        state = (
            f"o {minutes // 60} h {minutes % 60:02d} min" if minutes >= 60 else f"o {minutes} min"
        )
        state_tone = "neutral"
    return TimelineSegment(
        name=name, start=start, end=end, tone=tone, state=state, state_tone=state_tone
    )


def _depot_out(depot: Depot, look: Lookup, mode: str) -> DispatchDepot:
    from depotrack.api.depots import depot_label

    return DispatchDepot(
        code=depot.code,
        name=depot.name,
        label=depot_label(depot, list(look.directions.values())),
        mode="transship" if mode == "transship" else "delivery",
    )


# ------------------------------------------------------------------ delivery depot


def _delivery(db: Session, depot: Depot, look: Lookup) -> DispatchOut:
    clk = clock()
    day, now = clk.operating_day, clk.sim_time
    at = points(day, now)
    when = day + timedelta(days=1)
    routes = list(
        db.execute(
            select(CourierRoute)
            .join(Direction, CourierRoute.rajon_direction_id == Direction.id)
            .where(CourierRoute.date == when, Direction.depot_id == depot.id)
            .order_by(CourierRoute.id)
        ).scalars()
    )
    route_ids = [r.id for r in routes]
    stops = (
        db.execute(
            select(RouteStop, Parcel)
            .join(Parcel, RouteStop.parcel_id == Parcel.id)
            .where(RouteStop.route_id.in_(route_ids))
        )
        .tuples()
        .all()
        if route_ids
        else []
    )
    parcel_ids = [p.id for _, p in stops]
    events = (
        db.execute(
            select(ParcelEvent.parcel_id, ParcelEvent.status, ParcelEvent.at).where(
                ParcelEvent.parcel_id.in_(parcel_ids)
            )
        )
        .tuples()
        .all()
        if parcel_ids
        else []
    )
    first: dict[tuple[int, ParcelStatus], datetime] = {}
    for pid, st, t in events:
        if (pid, st) not in first or t < first[(pid, st)]:
            first[(pid, st)] = t
    on_truck = [t for (pid, st), t in first.items() if st == ParcelStatus.LOADED]
    out_times = [t for (pid, st), t in first.items() if st == ParcelStatus.OUT_FOR_DELIVERY]
    delivered = [
        s.delivered_at for s, _ in stops if s.outcome == StopOutcome.DELIVERED and s.delivered_at
    ]
    failed = sum(
        1 for s, _ in stops if s.outcome is not None and s.outcome != StopOutcome.DELIVERED
    )
    statuses = Counter(p.status for _, p in stops)
    total = len(stops)
    in_depot = statuses[ParcelStatus.LOADED]
    out_now = statuses[ParcelStatus.OUT_FOR_DELIVERY]
    done = sum(statuses[s] for s in DELIVERY) - out_now

    # the feeder truck: the linehaul trip whose direction ends here, its arrival at our gate
    feeders = [
        t
        for t in trips_of(db, day)
        if t.kind == TripKind.OUTBOUND
        and look.directions[t.direction_id].destination_depot_id == depot.id
    ]
    truck = feeders[0] if feeders else None
    plate = look.vehicles[truck.vehicle_id].plate if truck else None
    arrived = (
        db.execute(
            select(func.min(GateEvent.at)).where(
                GateEvent.depot_id == depot.id,
                GateEvent.plate == plate,
                GateEvent.direction == "in",
                GateEvent.at >= day_window(day)[0],
            )
        ).scalar_one_or_none()
        if plate
        else None
    )
    back = next(
        (
            t
            for t in trips_of(db, day)
            if t.kind == TripKind.INBOUND
            and look.directions[t.direction_id].destination_depot_id == depot.id
        ),
        None,
    )
    alerts_now, alert_spark = _alerts(db, depot, day, at)
    missed = (
        statuses[ParcelStatus.COLLECTED]
        + statuses[ParcelStatus.SORTED]
        + statuses[ParcelStatus.STAGED]
        + statuses[ParcelStatus.ON_BELT]
    )
    feeder_code = look.directions[truck.direction_id].code if truck else ""
    kpis = [
        KpiOut(
            key="arrived",
            label="Balíky z kamióna",
            tone="brand",
            value=num(total - missed),
            unit=f"/ {num(total)}",
            spark=cumulative(on_truck, at),
            delta=Delta(value=f"{num(missed)} nedorazilo", tone="warn")
            if missed and arrived
            else None,
            context=(
                f"kamión {feeder_code} prišiel {local_hhmm(arrived)}"
                if arrived
                else f"kamión {feeder_code} na ceste"
                if truck
                else "bez kamióna"
            ),
        ),
        KpiOut(
            key="out",
            label="Na doručenie",
            tone="info",
            value=num(out_now),
            unit=f"/ {num(total)}",
            spark=cumulative(out_times, at),
            context=f"{num(in_depot)} v sklade"
            if in_depot
            else "všetko naložené"
            if out_now
            else "nakládka od 06:30",
        ),
        KpiOut(
            key="delivered",
            label="Doručené",
            tone="ok",
            value=num(done),
            unit=f"/ {num(total)}",
            spark=cumulative(delivered, at),
            delta=Delta(value=f"{round(100 * done / total) if total else 0} %", tone="ok")
            if done
            else None,
            context=f"{num(failed)} nezastihnutých" if failed else "rozvoz od 07:30",
        ),
        KpiOut(
            key="couriers",
            label="Kuriéri na trase",
            tone="neutral",
            value=num(sum(1 for r in routes if r.departed_at and not r.returned_at)),
            unit=f"/ {len(routes)}",
            spark=open_at([(r.departed_at, r.returned_at) for r in routes if r.departed_at], at),
            context=f"{sum(1 for r in routes if r.returned_at)} späť v sklade"
            if any(r.returned_at for r in routes)
            else "odchod 07:30",
        ),
        _alert_kpi(alerts_now, alert_spark),
    ]
    groups = [
        TripGroup(
            key="couriers", tab="out", title="Kuriéri", sub=f"· {len(routes)} trás", tone="brand"
        ),
        TripGroup(
            key="lh-out",
            tab="out",
            title="Nočný diaľkový odchod",
            sub=f"· smer {_origin_name(db, look, truck)}",
            tone="neutral",
        ),
        TripGroup(
            key="lh-in",
            tab="in",
            title="Diaľkový kamión",
            sub=f"· balíky na rozvoz, z depa {_origin_name(db, look, truck)}",
            tone="brand",
        ),
    ]
    rows: list[TripRow] = []
    per_route = Counter(s.route_id for s, _ in stops)
    out_per_route = Counter(s.route_id for s, p in stops if p.status in DELIVERY)
    for r in routes:
        van = look.vehicles[r.vehicle_id]
        district = look.directions[r.rajon_direction_id]
        status, label, tone = (
            ("back", "Späť", "neutral")
            if r.returned_at
            else ("on_round", "Na trase", "info")
            if r.departed_at
            else ("loading", "Nakladá sa", "ok")
            if now >= _local(when, 6, 30)
            else ("planned", "Plánovaná", "neutral")
        )
        departure = _local(when, 7, 30)
        rows.append(
            TripRow(
                key=f"route-{r.id}",
                group="couriers",
                kind=TripKind.OUTBOUND,
                status=status,
                status_label=label,
                status_tone=tone,
                plan=departure,
                direction=district.name,
                plate=van.plate,
                type_label="kuriér",
                door=None,
                loaded=out_per_route[r.id],
                expected=per_route[r.id],
                missing=per_route[r.id] - out_per_route[r.id] if r.departed_at else None,
                loading_from=_local(when, 6, 30) if not r.departed_at else None,
                eta=r.departed_at or departure,
                delta_min=int((r.departed_at - departure).total_seconds() // 60)
                if r.departed_at
                else None,
                eta_by=None,
                risk=None,
                href="/courier",
            )
        )
    if truck:
        rows.append(_feeder_row(truck, look, "lh-in", arrived, plate or "", depot))
    if back:
        # the night truck back, as seen from here: when it left through our gate
        back_plate = look.vehicles[back.vehicle_id].plate
        left = db.execute(
            select(func.min(GateEvent.at)).where(
                GateEvent.depot_id == depot.id,
                GateEvent.plate == back_plate,
                GateEvent.direction == "out",
                GateEvent.at >= day_window(day)[0],
            )
        ).scalar_one_or_none()
        rows.append(_feeder_row(back, look, "lh-out", left, back_plate, depot))

    by_district: dict[int, list[int]] = {}
    route_district = {r.id: r.rajon_direction_id for r in routes}
    for s, p in stops:
        parts = by_district.setdefault(route_district[s.route_id], [0, 0, 0])
        if p.status in DELIVERY and p.status != ParcelStatus.OUT_FOR_DELIVERY:
            parts[0] += 1
        elif p.status == ParcelStatus.OUT_FOR_DELIVERY:
            parts[1] += 1
        elif p.status == ParcelStatus.LOADED:  # came on the truck, waits in the depot
            parts[2] += 1
    bars = sorted(
        (
            DirectionBar(name=look.directions[k].name, parts=v, total=sum(v))
            for k, v in by_district.items()
        ),
        key=lambda b: -b.total,
    )
    timeline = []
    if truck:
        arrive = arrived or (
            truck.planned_departure + timedelta(hours=4) if truck.planned_departure else None
        )
        if arrive:
            seg = _segment(
                f"Príchod kamióna {feeder_code}",
                arrive,
                arrive + timedelta(minutes=20),
                "brand",
                now,
            )
            seg.state = f"prišiel {local_hhmm(arrive)}" if arrived else seg.state
            timeline.append(seg)
    timeline.append(
        _segment(
            "Nakládka kuriérov", _local(when, 6, 30), _local(when, 7, 30), "ok", now, progress=True
        )
    )
    timeline.append(
        _segment("Rozvoz", _local(when, 7, 30), _local(when, 15, 0), "info", now, progress=True)
    )
    if back and back.planned_departure:
        timeline.append(
            _segment(
                "Večerný odchod kamióna",
                back.planned_departure,
                back.planned_departure + timedelta(minutes=20),
                "neutral",
                now,
            )
        )
    start, _ = day_window(day)
    return DispatchOut(
        depot=_depot_out(depot, look, "delivery"),
        clock=clk,
        summary=(
            f"{num(total)} balíkov na rozvoz z kamióna {feeder_code}, "
            f"{len(routes)} kuriérov, odchod 07:30"
            if truck
            else f"{len(routes)} kuriérov"
        ),
        kpis=kpis,
        groups=groups,
        trips=rows,
        alerts=[_alert_card(db, a, look, depot) for a in alerts_now],
        legend=["Doručené", "Na doručenie", "V sklade"],
        legend_totals=[sum(b.parts[i] for b in bars) for i in range(3)],
        directions=bars,
        day_start=start,
        timeline=timeline,
    )


def _origin_name(db: Session, look: Lookup, trip: Trip | None) -> str:
    """Where the feeder truck comes from: "Budimír"."""
    if trip is None:
        return "—"
    return db.get_one(Depot, look.directions[trip.direction_id].depot_id).name


def _feeder_row(
    t: Trip, look: Lookup, group: str, arrived: datetime | None, plate: str, depot: Depot
) -> TripRow:
    d = look.directions[t.direction_id]
    plan = t.planned_departure
    # seen from this depot: `arrived` is when the truck passed our gate (in or out)
    label: str
    tone: Tone
    if group == "lh-in":
        label, tone = (
            ("Prišiel", "neutral")
            if arrived
            else ("Na ceste", "info")
            if t.actual_departure
            else ("Nakladá sa", "neutral")
        )
    else:
        label, tone = ("Odišiel", "neutral") if arrived else ("Čaká na odchod", "neutral")
    return TripRow(
        key=f"trip-{t.id}",
        group=group,
        kind=t.kind,
        status=t.status,
        status_label=label,
        status_tone=tone,
        plan=arrived or plan,
        direction=d.name,
        plate=plate,
        type_label=KIND.get(d.type, ""),
        door=None,
        loaded=0,
        expected=0,
        missing=None,
        loading_from=None,
        eta=arrived or t.actual_departure or plan,
        delta_min=None,
        eta_by=t.predicted_by,
        risk=None,
        href=f"/fleet?plate={plate}",
    )


def dispatch(db: Session, depot: Depot) -> DispatchOut:
    look = Lookup(db)
    own_linehaul = any(
        d.depot_id == depot.id and d.type == DirectionType.LINEHAUL
        for d in look.directions.values()
    )
    return _transship(db, depot, look) if own_linehaul else _delivery(db, depot, look)
