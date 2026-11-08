"""What the login page shows before anyone signs in (phase 7d, maketa-login).

Public and rate-limited: the network of depots from the data (positions, connections), whether
the services run, how many ML models are loaded, the session length and, only in demo mode
(SIM_CONTROLS_ENABLED=true), the demo accounts as names and roles. Never a password.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from depotrack.api.depots import depot_label
from depotrack.core.config import Settings, get_settings
from depotrack.core.db import ping_database
from depotrack.core.ratelimit import limiter
from depotrack.core.rbac import DbSession
from depotrack.ml.delay import delay_model
from depotrack.ml.gate import gate_models
from depotrack.ml.scanner import scanner_model
from depotrack.models import Depot, Direction, User
from depotrack.models.enums import UserRole
from depotrack.schemas.internal import CamelModel
from depotrack.seed.operations import OPERATING
from depotrack.services import telematics

router = APIRouter(prefix="/api/public", tags=["public"])

ROLE_ORDER = (
    UserRole.ADMIN,
    UserRole.DISPATCHER,
    UserRole.OPERATOR,
    UserRole.SECURITY,
    UserRole.COURIER,
)


class NetworkDepot(CamelModel):
    code: str
    name: str
    label: str
    kind: str
    lat: float
    lon: float


class NetworkLink(CamelModel):
    origin: str
    destination: str
    # linehaul: trucks drive it today; planned: a feeder of a depot without operations yet
    kind: Literal["linehaul", "planned"]


class DemoAccount(CamelModel):
    username: str
    role: UserRole
    depot: str | None


class LoginInfoOut(CamelModel):
    depots: list[NetworkDepot]
    links: list[NetworkLink]
    services_ok: bool
    telemetry_live: bool
    ml_models: int
    session_hours: int
    # None outside the demo mode
    demo_accounts: list[DemoAccount] | None


def _links(depots: list[Depot], directions: list[Direction]) -> list[NetworkLink]:
    by_id = {d.id: d for d in depots}
    seen: set[tuple[str, str]] = set()
    out: list[NetworkLink] = []
    for x in directions:
        if x.destination_depot_id is None or x.destination_depot_id == x.depot_id:
            continue
        pair = (by_id[x.depot_id].code, by_id[x.destination_depot_id].code)
        if pair not in seen:
            seen.add(pair)
            out.append(NetworkLink(origin=pair[0], destination=pair[1], kind="linehaul"))
    # depots without operations yet are fed from the hub (plan-doplnky, phase 7c)
    hub = next((d for d in depots if d.kind == "hub"), None)
    for d in depots:
        if hub and d.code not in OPERATING and d.id != hub.id:
            out.append(NetworkLink(origin=hub.code, destination=d.code, kind="planned"))
    return out


def _demo_accounts(db: DbSession) -> list[DemoAccount]:
    """One account per role, couriers one per depot that has them (names and roles only)."""
    users = list(
        db.execute(select(User).where(User.active.is_(True)).order_by(User.username)).scalars()
    )
    out: list[DemoAccount] = []
    for role in ROLE_ORDER:
        of_role = [u for u in users if u.role == role]
        if role == UserRole.COURIER:
            firsts: dict[str | None, User] = {}
            for u in of_role:
                firsts.setdefault(u.home_depot_code, u)
            of_role = list(firsts.values())
        else:
            of_role = of_role[:1]
        out += [
            DemoAccount(username=u.username, role=u.role, depot=u.home_depot_code) for u in of_role
        ]
    return out


@router.get("/login-info", response_model=LoginInfoOut, response_model_by_alias=True)
@limiter.limit("60/minute")
def login_info(
    request: Request, db: DbSession, settings: Annotated[Settings, Depends(get_settings)]
) -> LoginInfoOut:
    depots = list(db.execute(select(Depot).order_by(Depot.id)).scalars())
    directions = list(db.execute(select(Direction)).scalars())
    live = telematics.sim_now_or_none() is not None
    try:
        ping_database()
        db_ok = True
    except SQLAlchemyError:
        db_ok = False
    gate = gate_models() is not None
    models = int(delay_model() is not None) + int(scanner_model() is not None) + (2 if gate else 0)
    return LoginInfoOut(
        depots=[
            NetworkDepot(
                code=d.code,
                name=d.name,
                label=depot_label(d, directions),
                kind=d.kind,
                lat=d.lat,
                lon=d.lon,
            )
            for d in depots
        ],
        links=_links(depots, directions),
        services_ok=db_ok and live,
        telemetry_live=live,
        ml_models=models,
        session_hours=settings.session_ttl_hours,
        demo_accounts=_demo_accounts(db) if settings.sim_controls_enabled else None,
    )
