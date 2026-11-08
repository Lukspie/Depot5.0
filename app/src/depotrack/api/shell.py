"""The application shell (phase 7d, design system v2): what the top bar and the side navigation
show for the signed-in user. One small call instead of the dashboard, which other roles may not
read: the current wave, the number of open alerts, the gate queue and the link to the board."""

from datetime import datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from depotrack.core.clock import TZ
from depotrack.core.config import Settings, get_settings
from depotrack.core.rbac import DbSession, require_role
from depotrack.models import GateEvent, User
from depotrack.models.enums import UserRole
from depotrack.schemas.internal import CamelModel
from depotrack.services import gate as gate_rules
from depotrack.services import telematics
from depotrack.services.depot_scope import alerts_of_depot, can_switch, resolve_depot
from depotrack.services.kpis import open_alerts
from depotrack.services.views import clock
from depotrack.services.waves import EVENING, NIGHT, current_wave

router = APIRouter(prefix="/api", tags=["shell"])

AnyUser = Annotated[User, Depends(require_role(*UserRole))]

WAVES = {"evening": ("Večerná vlna", EVENING), "night": ("Nočná vlna", NIGHT)}
# who sees the alerts and the gate queue (the same roles as /api/alerts and /api/gate/queue)
ALERT_ROLES = (UserRole.ADMIN, UserRole.DISPATCHER, UserRole.SECURITY)
GATE_ROLES = (UserRole.ADMIN, UserRole.SECURITY)
BOARD_ROLES = (UserRole.ADMIN, UserRole.DISPATCHER)


class WaveOut(CamelModel):
    code: str
    name: str
    start: str  # "01:00"
    end: str


class ShellOut(CamelModel):
    sim_time: datetime
    operating_day: str
    wave: WaveOut | None
    # None: the role does not see them
    open_alerts: int | None
    gate_queue: int | None
    board_url: str | None


@router.get("/shell", response_model=ShellOut, response_model_by_alias=True)
def shell(
    user: AnyUser,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    depot: Annotated[str | None, Query(max_length=8)] = None,
) -> ShellOut:
    """The shell for the depot shown (the user's own when absent, ADR-068)."""
    d = resolve_depot(db, user, depot)
    clk = clock()
    code = current_wave(clk.sim_time.astimezone(TZ))
    wave = None
    if code is not None:
        name, (start, end) = WAVES[code]
        wave = WaveOut(code=code, name=name, start=f"{start:%H:%M}", end=f"{end:%H:%M}")
    alerts = None
    if user.role in ALERT_ROLES:
        today = open_alerts(db, 500, clk.operating_day)
        alerts = len(alerts_of_depot(db, today, d, unplaced=can_switch(user)))
    queue = None
    if user.role in GATE_ROLES:
        queue = db.execute(
            select(func.count())
            .select_from(GateEvent)
            .where(
                GateEvent.resolution.is_(None),
                GateEvent.decision != gate_rules.AUTO_PASS,
                GateEvent.at <= telematics.sim_now(),
                GateEvent.depot_id == d.id,
            )
        ).scalar_one()
    board = None
    if user.role in BOARD_ROLES and settings.board_key:
        board = f"/board?key={quote(settings.board_key)}"
    return ShellOut(
        sim_time=clk.sim_time,
        operating_day=clk.operating_day.isoformat(),
        wave=wave,
        open_alerts=alerts,
        gate_queue=queue,
        board_url=board,
    )
