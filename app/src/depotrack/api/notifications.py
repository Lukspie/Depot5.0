"""Admin: simulated SMS to customers with their tracking links (ADR-010: admin only)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from depotrack.core.rbac import DbSession, require_role
from depotrack.models import CustomerNotification, Parcel
from depotrack.models.enums import UserRole
from depotrack.schemas.delivery import NotificationOut

router = APIRouter(
    prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_role(UserRole.ADMIN))]
)


@router.get("/notifications", response_model=list[NotificationOut], response_model_by_alias=True)
def notifications(
    db: DbSession,
    q: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[NotificationOut]:
    """Newest first; `q` filters by barcode prefix or recipient."""
    stmt = (
        select(CustomerNotification, Parcel.barcode)
        .join(Parcel, CustomerNotification.parcel_id == Parcel.id)
        .order_by(CustomerNotification.created_at.desc(), CustomerNotification.id.desc())
        .limit(limit)
    )
    if q:
        term = q.strip()
        stmt = stmt.where(
            Parcel.barcode.ilike(f"{term}%") | CustomerNotification.recipient.ilike(f"%{term}%")
        )
    return [
        NotificationOut(
            id=n.id,
            parcel_id=n.parcel_id,
            barcode=barcode,
            channel=n.channel,
            recipient=n.recipient,
            message=n.message,
            link=n.link,
            created_at=n.created_at,
        )
        for n, barcode in db.execute(stmt).all()
    ]
