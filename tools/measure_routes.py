"""Courier stop order, measured on every route in db-wms (ADR-062).

    MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -v "$(pwd -W)/tools:/tools" app python /tools/measure_routes.py

Compares the window-aware order (services/routing.py plan_tour) with the phase 4 order and timing
(nearest neighbour, no waiting). A handover is missed when the van is there outside its window
(too early: the customer is not home yet; too late). Duration = departure 07:30 to the last stop.
"""

import statistics
from datetime import datetime, time

from sqlalchemy import select

from depotrack.core.clock import TZ
from depotrack.core.db import get_session_factory
from depotrack.models import CourierRoute, Depot, Parcel, RouteStop
from depotrack.services.routing import Stop, nearest_neighbour_tour, plan_tour, tour_km

with get_session_factory()() as db:
    depot = db.execute(select(Depot).where(Depot.code == "BUD")).scalar_one()
    start = (depot.lat, depot.lon)
    routes = list(db.execute(select(CourierRoute).order_by(CourierRoute.id)).scalars())
    stats = {name: {"missed": 0, "handovers": 0, "km": 0.0, "minutes": [], "after15": 0} for name in ("phase 4", "windows")}
    for r in routes:
        parcels = list(
            db.execute(
                select(Parcel).join(RouteStop, RouteStop.parcel_id == Parcel.id).where(RouteStop.route_id == r.id)
            ).scalars()
        )
        stops = [
            Stop(
                p.barcode,
                p.lat,
                p.lon,
                p.delivery_type,
                (datetime.combine(r.date, p.window_from, TZ), datetime.combine(r.date, p.window_to, TZ))
                if p.window_from and p.window_to
                else None,
            )
            for p in parcels
        ]
        if not stops:
            continue
        depart = datetime.combine(r.date, time(7, 30), TZ)
        for name, tour in (("phase 4", nearest_neighbour_tour), ("windows", plan_tour)):
            visits = tour(start, depart, stops)
            s = stats[name]
            s["missed"] += sum(1 for v in visits if v.missed)
            s["handovers"] += sum(1 for v in visits if v.stop.window is not None)
            s["km"] += tour_km(start, visits)
            s["minutes"].append((visits[-1].eta - depart).total_seconds() / 60)
            s["after15"] += visits[-1].eta.astimezone(TZ).time() > time(15, 0)
    n = len(stats["windows"]["minutes"])
    print(f"{n} routes")
    for name, s in stats.items():
        print(
            f"{name:8} missed windows {s['missed']}/{s['handovers']} ({s['missed'] / max(1, s['handovers']):.1%}), "
            f"km {s['km']:.0f} ({s['km'] / n:.1f}/route), duration median {statistics.median(s['minutes']):.0f} min, "
            f"max {max(s['minutes']):.0f} min, last stop after 15:00 on {s['after15']}/{n} routes"
        )
