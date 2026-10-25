"""Admin: directions (departure and cut-off times shown on the board and used by new plans)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from depotrack.core.rbac import DbSession, require_role
from depotrack.models import Direction, Door, User
from depotrack.models.enums import UserRole
from depotrack.schemas.wms import DirectionOut, DirectionUpdate

router = APIRouter(prefix="/api/admin/directions", tags=["admin"])

Admin = Annotated[User, Depends(require_role(UserRole.ADMIN))]


def _out(d: Direction, door_code: str | None) -> DirectionOut:
    return DirectionOut(
        id=d.id,
        code=d.code,
        name=d.name,
        type=d.type,
        cutoff_time=d.cutoff_time,
        planned_departure=d.planned_departure,
        depends_on_linehaul=list(d.depends_on_linehaul),
        door_code=door_code,
    )


def _doors(db: DbSession) -> dict[int, str]:
    rows = db.execute(
        select(Door.direction_id, Door.code).where(Door.direction_id.is_not(None))
    ).all()
    return {did: code for did, code in rows if did is not None}


@router.get("", response_model=list[DirectionOut], response_model_by_alias=True)
def list_directions(_: Admin, db: DbSession) -> list[DirectionOut]:
    doors = _doors(db)
    rows = db.execute(select(Direction).order_by(Direction.type, Direction.code)).scalars()
    return [_out(d, doors.get(d.id)) for d in rows]


@router.patch("/{direction_id}", response_model=DirectionOut, response_model_by_alias=True)
def update_direction(
    direction_id: int, body: DirectionUpdate, _: Admin, db: DbSession
) -> DirectionOut:
    """Changes apply to trip plans created from now on (existing days keep their times)."""
    d = db.get(Direction, direction_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Direction not found")
    for field in body.model_fields_set:
        setattr(d, field, getattr(body, field))
    db.commit()
    return _out(d, _doors(db).get(d.id))
