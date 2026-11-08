"""Internal API used by telematics (X-Service-Token). The app is the source of truth for trips and
parcels: telematics reads the plan and manifests here and reports how the trips are executed."""

from collections import Counter
from datetime import date, datetime, timedelta
from typing import Annotated, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import aliased

from depotrack.core.clock import TZ
from depotrack.core.config import Settings, get_settings
from depotrack.core.rbac import DbSession
from depotrack.core.service_auth import require_service_token
from depotrack.models import (
    Alert,
    CourierRoute,
    Depot,
    Direction,
    Door,
    Parcel,
    ParcelEvent,
    RouteStop,
    Trip,
    User,
    Vehicle,
)
from depotrack.models.enums import DirectionType, DoorKind, EventSource, ParcelStatus, StopOutcome
from depotrack.schemas.internal import (
    AlertIn,
    AlertOut,
    CourierEventsIn,
    CourierEventsOut,
    CourierPlanOut,
    CourierPlanRoute,
    CourierPlanStop,
    GateEventsIn,
    GateEventsOut,
    ManifestOut,
    ManifestParcel,
    PlanDepot,
    PlanOut,
    PlanTripOut,
    ScanEventsIn,
    ScanEventsOut,
    TripEventsIn,
    TripEventsOut,
)
from depotrack.seed.depots import to_latlon
from depotrack.services import gate as gate_rules
from depotrack.services import telematics
from depotrack.services.alerts import AlertChange, alert_event, resolve_alert, upsert_alert
from depotrack.services.cascade import evaluate_cascade
from depotrack.services.couriers import (
    complete_stop,
    depot_of_route,
    load_parcel,
    routes_of_day,
    staging_bay,
)
from depotrack.services.loading import line_scan, loading_dock, process_scan, scan_event
from depotrack.services.ml_eta import ML, TELEMATICS
from depotrack.services.operating_day import ensure_operating_day, reset_operating_day
from depotrack.services.parcels import LOADABLE, in_day
from depotrack.services.routing import DeliveryType
from depotrack.services.trip_plan import operating_day_of
from depotrack.services.waves import close_evening_wave

router = APIRouter(
    prefix="/internal", tags=["internal"], dependencies=[Depends(require_service_token)]
)

SettingsDep = Annotated[Settings, Depends(get_settings)]


def _broadcast_alerts(background: BackgroundTasks, changes: list[AlertChange]) -> None:
    if changes:
        events = [alert_event(c.alert) for c in changes]
        background.add_task(telematics.broadcast_many, "alerts", "alert", events)


@router.get("/plan", response_model=PlanOut, response_model_by_alias=True)
def get_plan(day: Annotated[date, Query()], db: DbSession, settings: SettingsDep) -> PlanOut:
    """Trip plan of an operating day; created on first request (with that day's parcels)."""
    ensure_operating_day(db, settings, day)
    door = aliased(Door)
    rows = db.execute(
        select(Trip, Vehicle, Direction, door.code)
        .join(Vehicle, Trip.vehicle_id == Vehicle.id)
        .join(Direction, Trip.direction_id == Direction.id)
        .outerjoin(door, Trip.door_id == door.id)
        .where(Trip.operating_day == day)
        .order_by(Trip.id)
    ).all()
    trips = [
        PlanTripOut(
            id=t.id,
            operating_day=t.operating_day,
            kind=t.kind,
            status=t.status,
            vehicle_plate=v.plate,
            vehicle_kind=v.kind,
            direction_code=d.code,
            direction_name=d.name,
            direction_type=d.type,
            depends_on_linehaul=list(d.depends_on_linehaul),
            door_code=door_code,
            planned_arrival=t.planned_arrival,
            planned_departure=t.planned_departure,
            actual_arrival=t.actual_arrival,
            actual_departure=t.actual_departure,
            predicted_arrival=t.predicted_arrival,
        )
        for t, v, d, door_code in rows
    ]
    depot = db.execute(select(Depot).where(Depot.code == "BUD")).scalar_one()
    # the courier districts of Budimír (other depots have their own, phase 7c)
    local = db.execute(
        select(Direction.code)
        .where(Direction.type == DirectionType.LOCAL, Direction.depot_id == depot.id)
        .order_by(Direction.code)
    ).scalars()
    destinations = {
        d.code: (d.dest_lat, d.dest_lon)
        for d in db.execute(select(Direction).where(Direction.depot_id == depot.id)).scalars()
        if d.dest_lat is not None and d.dest_lon is not None
    }
    codes = {d.id: d.code for d in db.execute(select(Depot)).scalars()}
    ends = {
        d.code: codes[d.destination_depot_id]
        for d in db.execute(select(Direction).where(Direction.depot_id == depot.id)).scalars()
        if d.destination_depot_id is not None
    }
    return PlanOut(
        day=day,
        destination_depots=ends,
        cascade_buffer_min=settings.cascade_buffer_min,
        trips=trips,
        local_directions=list(local),
        depot=PlanDepot(code=depot.code, name=depot.name, lat=depot.lat, lon=depot.lon),
        destinations=destinations,
    )


@router.get("/manifest", response_model=ManifestOut, response_model_by_alias=True)
def get_manifest(
    direction: Annotated[str, Query(max_length=16)],
    day: Annotated[date, Query()],
    db: DbSession,
) -> ManifestOut:
    """Parcels of one direction and operating day that are still waiting to be loaded.
    Night parcels carry the inbound trip that brings them."""
    collected = (
        select(ParcelEvent.parcel_id, ParcelEvent.trip_id)
        .where(ParcelEvent.status == ParcelStatus.COLLECTED, ParcelEvent.trip_id.is_not(None))
        .subquery()
    )
    rows = db.execute(
        select(Parcel.barcode, Parcel.weight_kg, collected.c.trip_id)
        .join(Direction, Parcel.direction_id == Direction.id)
        .outerjoin(collected, collected.c.parcel_id == Parcel.id)
        .where(Direction.code == direction, Parcel.status.in_(LOADABLE), in_day(day))
        .order_by(Parcel.barcode)
    ).all()
    return ManifestOut(
        direction=direction,
        day=day,
        parcels=[
            ManifestParcel(barcode=b, weight_kg=w, arrives_with_trip_id=t) for b, w, t in rows
        ],
    )


@router.post("/events/trips", response_model=TripEventsOut, response_model_by_alias=True)
def trip_events(
    body: TripEventsIn, db: DbSession, settings: SettingsDep, background: BackgroundTasks
) -> TripEventsOut:
    """Mirror the execution state of trips and re-evaluate the delay cascade."""
    unknown: list[int] = []
    touched: list[Trip] = []
    for ev in body.trips:
        trip = db.get(Trip, ev.trip_id)
        if trip is None:
            unknown.append(ev.trip_id)
            continue
        trip.status = ev.status
        trip.actual_arrival = ev.actual_arrival
        trip.actual_departure = ev.actual_departure
        if ev.predicted_arrival is not None:
            trip.predicted_arrival = ev.predicted_arrival
            trip.predicted_by = TELEMATICS
        elif trip.predicted_by != ML or ev.actual_arrival is not None:
            # keep the ML prediction until telematics has its own or the truck arrived (ADR-057)
            trip.predicted_arrival = None
            trip.predicted_by = None
        touched.append(trip)
    db.flush()

    buffer = timedelta(minutes=settings.cascade_buffer_min)
    changes: list[AlertChange] = []
    for trip in touched:
        changes.extend(evaluate_cascade(db, trip, buffer, body.sim_time))
    # after 22:00 the regional/Košice parcels left from the evening go to the staging areas
    today = operating_day_of(body.sim_time)
    for day in (today - timedelta(days=1), today):
        close_evening_wave(db, day, body.sim_time)
    db.commit()
    _broadcast_alerts(background, changes)
    return TripEventsOut(updated=len(touched), unknown=unknown, alerts_changed=len(changes))


@router.post("/events/scans", response_model=ScanEventsOut, response_model_by_alias=True)
def scan_events(body: ScanEventsIn, db: DbSession, background: BackgroundTasks) -> ScanEventsOut:
    """IoT scans from telematics: dock scanners -> loading check, line scanner -> sorting."""
    results: Counter[str] = Counter()
    skipped = 0
    events: list[dict[str, object]] = []
    alerts: list[AlertChange] = []
    for scan in body.scans:
        if scan.door_code is None:
            if line_scan(db, at=scan.at, barcode=scan.barcode if scan.read_ok else None):
                results["sorted"] += 1
            continue
        door = loading_dock(db, scan.door_code)
        outcome = (
            process_scan(
                db,
                door=door,
                at=scan.at,
                barcode=scan.barcode if scan.read_ok else None,
                source=EventSource.IOT,
                device=scan.device,
            )
            if door
            else None
        )
        if outcome is None:
            skipped += 1
            continue
        results[outcome.result.value] += 1
        events.append(scan_event(outcome))
        if outcome.alert:
            alerts.append(outcome.alert)
    db.commit()
    if events:
        background.add_task(telematics.broadcast_many, "devices", "loading_scan", events)
    _broadcast_alerts(background, alerts)
    return ScanEventsOut(processed=sum(results.values()), skipped=skipped, results=dict(results))


@router.post("/events/gate", response_model=GateEventsOut, response_model_by_alias=True)
def gate_events(body: GateEventsIn, db: DbSession, background: BackgroundTasks) -> GateEventsOut:
    """Simulated gate passages: the same rules as the camera decide them (ADR-061)."""
    decisions: Counter[str] = Counter()
    duplicates = 0
    alerts: list[AlertChange] = []
    known = set(db.execute(select(Depot.code)).scalars())
    unknown = sorted({p.depot for p in body.passages} - known)
    if unknown:
        # a whole batch would fail on one bad code; telematics must not resend it forever
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown depot: {unknown[0]}")
    for p in body.passages:
        stored = gate_rules.record(
            db,
            gate_rules.Reading(
                direction=p.direction,
                vehicle_type=p.vehicle_type,
                vehicle_confidence=p.vehicle_confidence,
                plate=p.plate,
                plate_confidence=p.plate_confidence,
            ),
            at=p.at,
            source="sim",
            external_key=p.key,
            depot=p.depot,
        )
        if stored is None:
            duplicates += 1
            continue
        decisions[stored.verdict.decision] += 1
        if stored.alert is not None:
            alerts.append(stored.alert)
    db.commit()
    _broadcast_alerts(background, alerts)
    return GateEventsOut(
        stored=sum(decisions.values()), duplicates=duplicates, decisions=dict(decisions)
    )


@router.get("/courier-routes", response_model=CourierPlanOut, response_model_by_alias=True)
def courier_plan(
    day: Annotated[date, Query()], db: DbSession, settings: SettingsDep
) -> CourierPlanOut:
    """Courier routes for the parcels of operating day `day` (driven on the morning of day+1)."""
    ensure_operating_day(db, settings, day)
    depot = db.execute(select(Depot).where(Depot.code == "BUD")).scalar_one()
    out: list[CourierPlanRoute] = []
    for route in routes_of_day(db, day):
        van = db.get(Vehicle, route.vehicle_id)
        courier = db.get(User, route.courier_user_id)
        district = db.get(Direction, route.rajon_direction_id)
        bay = staging_bay(db, route.rajon_direction_id)
        stops = db.execute(
            select(RouteStop, Parcel)
            .join(Parcel, RouteStop.parcel_id == Parcel.id)
            .where(RouteStop.route_id == route.id)
            .order_by(RouteStop.sequence)
        ).all()
        out.append(
            CourierPlanRoute(
                route_id=route.id,
                date=route.date,
                vehicle_plate=van.plate if van else "?",
                courier_username=courier.username if courier else "?",
                district_code=district.code if district else "?",
                staging_bay=bay.code if bay else None,
                stops=[
                    CourierPlanStop(
                        stop_id=st.id,
                        sequence=st.sequence,
                        barcode=p.barcode,
                        lat=p.lat,
                        lon=p.lon,
                        delivery_type=cast(DeliveryType, p.delivery_type),
                        window_from=datetime.combine(route.date, p.window_from, TZ)
                        if p.window_from
                        else None,
                    )
                    for st, p in stops
                ],
                **_route_places(db, route, bay.code if bay else None),
            )
        )
    return CourierPlanOut(
        day=day,
        depot=PlanDepot(code=depot.code, name=depot.name, lat=depot.lat, lon=depot.lon),
        routes=out,
    )


def _route_places(db: DbSession, route: CourierRoute, bay: str | None) -> dict[str, object]:
    """Depot of the round and the van's parking and loading spot from the layout (ADR-064/065)."""
    home = depot_of_route(db, route)
    out: dict[str, object] = {
        "depot": PlanDepot(code=home.code, name=home.name, lat=home.lat, lon=home.lon)
    }
    layout = home.layout if isinstance(home.layout, dict) else {}
    yard = layout.get("yard")
    if not isinstance(yard, dict) or "origin" not in layout:
        return out
    bays = sorted(
        d.code
        for d in db.execute(select(Door).where(Door.depot_id == home.id)).scalars()
        if d.kind == DoorKind.STAGING_BAY
    )
    parking = yard.get("vanParking") or []
    if bay in bays and bays.index(bay) < len(parking):
        p = parking[bays.index(bay)]
        out["parking"] = to_latlon(layout, float(p["x"]), float(p["y"]))
    loading = next((s for s in yard.get("vanLoading") or [] if s.get("bay") == bay), None)
    if loading:
        out["loading"] = to_latlon(layout, float(loading["x"]), float(loading["y"]))
    return out


@router.post("/events/couriers", response_model=CourierEventsOut, response_model_by_alias=True)
def courier_events(body: CourierEventsIn, db: DbSession, settings: SettingsDep) -> CourierEventsOut:
    """Courier execution from the simulator: ETA predictions, parcels scanned into the van
    (-> tracking link + SMS), departure, delivered / not reached, return to the depot."""
    stop_ids = {e.stop_id for e in body.etas} | {e.stop_id for e in body.events if e.stop_id}
    stops = {
        s.id: s for s in db.execute(select(RouteStop).where(RouteStop.id.in_(stop_ids))).scalars()
    }
    for eta in body.etas:
        stop = stops.get(eta.stop_id)
        if stop is not None and stop.outcome is None:
            stop.predicted_eta = eta.eta
    routes: dict[int, CourierRoute | None] = {}
    applied = ignored = notifications = 0
    for ev in sorted(body.events, key=lambda e: e.at):
        if ev.route_id not in routes:
            routes[ev.route_id] = db.get(CourierRoute, ev.route_id)
        route = routes[ev.route_id]
        stop = stops.get(ev.stop_id) if ev.stop_id else None
        if route is None or (
            ev.stop_id is not None and (stop is None or stop.route_id != route.id)
        ):
            ignored += 1
            continue
        done = False
        if ev.kind == "departed" and route.departed_at is None:
            route.departed_at = ev.at
            done = True
        elif ev.kind == "returned" and route.returned_at is None:
            route.returned_at = ev.at
            done = True
        elif ev.kind == "loaded" and stop is not None:
            bay = staging_bay(db, route.rajon_direction_id)
            note = load_parcel(db, settings, route=route, stop=stop, at=ev.at, door=bay)
            done = note is not None
            notifications += int(done)
        elif ev.kind in ("delivered", "failed") and stop is not None:
            done = complete_stop(
                db,
                stop=stop,
                outcome=StopOutcome.DELIVERED if ev.kind == "delivered" else StopOutcome.FAILED,
                at=ev.at,
                source=EventSource.MANUAL,
                user_id=route.courier_user_id,
            )
        applied += int(done)
        ignored += int(not done)
        db.flush()
    db.commit()
    return CourierEventsOut(applied=applied, ignored=ignored, notifications=notifications)


@router.post("/days/{day}/reset")
def reset_day(day: date, db: DbSession, clean: Annotated[bool, Query()] = False) -> dict[str, int]:
    """Telematics replays the day from 15:00 (new seed / restart): undo its execution here.
    `clean=true` is the clean reset of the admin (ADR-053)."""
    return reset_operating_day(db, day, clean=clean)


@router.post("/alerts", response_model=AlertOut | None, response_model_by_alias=True)
def post_alert(body: AlertIn, db: DbSession, background: BackgroundTasks) -> Alert | None:
    """Alert raised by telematics (e.g. device offline); `resolved=true` closes it."""
    at = body.at or telematics.sim_now()
    if body.resolved:
        if body.ref_type is None or body.ref_id is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "resolve needs refType+refId")
        alert = resolve_alert(db, kind=body.kind, ref_type=body.ref_type, ref_id=body.ref_id, at=at)
        db.commit()
        if alert is not None:
            _broadcast_alerts(background, [AlertChange(alert, created=False)])
        return alert
    change = upsert_alert(
        db,
        kind=body.kind,
        severity=body.severity,
        message=body.message,
        ref_type=body.ref_type,
        ref_id=body.ref_id,
        at=at,
    )
    db.commit()
    _broadcast_alerts(background, [change])
    return change.alert
