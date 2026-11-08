"""Seed: idempotency, reference data and plausibility of generated parcels."""

from datetime import date

from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from conftest import alembic_config
from depotrack.core.config import get_settings
from depotrack.core.db import get_engine
from depotrack.core.security import verify_password
from depotrack.models import Direction, Door, Parcel, ParcelEvent, SeedMeta, User, Vehicle, Wave
from depotrack.models.enums import DirectionType, DoorKind, UserRole
from depotrack.seed import seed_users
from depotrack.seed.generator import generate_parcels, kosice_rajon
from depotrack.services.operating_day import run_seed

DAY = date(2026, 10, 23)  # a Friday


def _count(db: Session, model: type) -> int:
    return db.execute(select(func.count()).select_from(model)).scalar_one()


def test_seed_is_idempotent_and_complete(db: Session) -> None:
    settings = get_settings().model_copy(update={"seed_parcels_per_day": 200})
    run_seed(db, settings, DAY)
    counts = {m: _count(db, m) for m in (Direction, Door, Vehicle, User, Wave, Parcel, ParcelEvent)}
    run_seed(db, settings, DAY)
    assert {m: _count(db, m) for m in counts} == counts

    assert counts[Direction] == 3 + 5 + 8
    # docks, staging bays, gate, Bratislava hub ramps + Žilina (6 ramps, 4 courier doors, gate)
    assert counts[Door] == 8 + 8 + 1 + 6 + 6 + 4 + 1
    assert counts[Vehicle] == 12 + 8
    assert counts[User] == 6 + 8  # admin, 3 dispatchers (one per shift), operator, security
    assert counts[Wave] == 2
    # 200 collected parcels + parcels brought by the 3 night trucks; one event each
    assert counts[Parcel] == counts[ParcelEvent]
    assert 200 + 3 * 110 <= counts[Parcel] <= 200 + 3 * 190


def test_three_dispatchers_one_per_shift_also_added_to_an_old_seed(
    db: Session, client: TestClient
) -> None:
    settings = get_settings().model_copy(update={"seed_parcels_per_day": 10})
    # a database seeded before phase 7b: only the first dispatcher, without a shift
    seed_users(db, settings)
    for u in db.execute(
        select(User).where(User.username.in_(["dispecer2", "dispecer3"]))
    ).scalars():
        db.delete(u)
    db.execute(update(User).values(shift=None))
    db.add(SeedMeta(key="users:v1"))
    db.commit()
    run_seed(db, settings, DAY)
    rows = db.execute(
        select(User.username, User.shift).where(User.role == UserRole.DISPATCHER)
    ).all()
    shifts = {name: shift for name, shift in rows}
    assert shifts == {"dispecer": "morning", "dispecer2": "afternoon", "dispecer3": "night"}
    # the password of the new accounts comes from .env (SEED_DISPATCHER_PASSWORD)
    third = db.execute(select(User).where(User.username == "dispecer3")).scalar_one()
    assert verify_password(third.password_hash, settings.seed_dispatcher_password or "")

    # visible and editable in the admin
    assert (
        client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin-test-heslo"}
        ).status_code
        == 200
    )
    listed = {u["username"]: u["shift"] for u in client.get("/api/admin/users").json()}
    assert listed["dispecer2"] == "afternoon" and listed["operator"] is None
    res = client.patch(f"/api/admin/users/{third.id}", json={"shift": "morning"})
    assert res.status_code == 200 and res.json()["shift"] == "morning"
    assert (
        client.patch(f"/api/admin/users/{third.id}", json={"full_name": "Zuzana M."}).json()[
            "shift"
        ]
        == "morning"
    )
    assert (
        client.patch(f"/api/admin/users/{third.id}", json={"shift": "evening"}).status_code == 422
    )
    # only a dispatcher has a shift (the backend decides, not the dialog)
    operator = db.execute(select(User).where(User.username == "operator")).scalar_one()
    assert (
        client.patch(f"/api/admin/users/{operator.id}", json={"shift": "night"}).status_code == 422
    )
    new = {
        "username": "op2",
        "full_name": "Op Two",
        "role": "operator",
        "password": "heslo-12345",
        "shift": "night",
    }
    assert client.post("/api/admin/users", json=new).status_code == 422
    moved = client.patch(f"/api/admin/users/{third.id}", json={"role": "operator"})
    assert moved.status_code == 200 and moved.json()["shift"] is None


def test_seed_reference_data_matches_domain(db: Session) -> None:
    settings = get_settings().model_copy(update={"seed_parcels_per_day": 10})
    run_seed(db, settings, DAY)

    transit = db.execute(select(Direction).where(Direction.type == DirectionType.TRANSIT)).scalars()
    by_code = {d.code: d for d in transit}
    assert set(by_code) == {"MI", "TV", "HE", "SL", "SE"}
    linehaul_codes = {"BB", "BA", "ZA"}
    for d in by_code.values():
        assert d.depends_on_linehaul and set(d.depends_on_linehaul) <= linehaul_codes

    docks = db.execute(select(Door).where(Door.kind == DoorKind.LOADING_DOCK)).scalars().all()
    dock_dirs = {db.get(Direction, d.direction_id).code for d in docks if d.direction_id}  # type: ignore[union-attr]
    assert dock_dirs == linehaul_codes | set(by_code)

    admin = db.execute(select(User).where(User.role == UserRole.ADMIN)).scalar_one()
    assert verify_password(admin.password_hash, "admin-test-heslo")


def test_new_day_adds_parcels_but_not_reference_data(db: Session) -> None:
    settings = get_settings().model_copy(update={"seed_parcels_per_day": 20})
    run_seed(db, settings, DAY)
    first = _count(db, Parcel)
    run_seed(db, settings, date(2026, 10, 24))
    assert _count(db, Parcel) - first >= 20
    assert _count(db, Direction) == 16


def test_generated_parcels_are_plausible() -> None:
    parcels = generate_parcels(DAY, 2000, seed=42)
    weights = [p.weight_kg for p in parcels]
    assert all(0.1 <= w <= 30 for w in weights)
    typical = sum(0.5 <= w <= 5 for w in weights) / len(weights)
    assert typical > 0.75, "most parcels should weigh 0.5-5 kg"

    local = [p for p in parcels if p.direction_code.startswith("KE-")]
    assert 0.2 < len(local) / len(parcels) < 0.4
    for p in local:
        assert p.direction_code == kosice_rajon(p.lat, p.lon)
        assert "Košice" in p.address
    assert len({p.direction_code for p in local}) == 8

    assert len({p.barcode for p in parcels}) == len(parcels)


def test_generator_is_deterministic() -> None:
    assert generate_parcels(DAY, 50, seed=1) == generate_parcels(DAY, 50, seed=1)
    assert generate_parcels(DAY, 50, seed=1) != generate_parcels(DAY, 50, seed=2)


def test_migrations_downgrade_and_upgrade() -> None:
    cfg = alembic_config()
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    # the enum types now have new OIDs: pooled connections keep statements psycopg prepared
    # with the old ones ("cache lookup failed for type" in later tests)
    get_engine().dispose()
