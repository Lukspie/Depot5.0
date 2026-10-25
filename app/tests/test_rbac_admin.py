"""Role-based access control and admin user management."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.models import UserSession
from depotrack.models.enums import UserRole


def test_admin_endpoints_require_login(client: TestClient) -> None:
    assert client.get("/api/admin/users").status_code == 401
    assert client.post("/api/admin/users", json={}).status_code == 401


@pytest.mark.parametrize(
    ("role", "expected"),
    [
        (UserRole.ADMIN, 200),
        (UserRole.DISPATCHER, 403),
        (UserRole.OPERATOR, 403),
        (UserRole.SECURITY, 403),
        (UserRole.COURIER, 403),
    ],
)
def test_admin_users_role_matrix(
    client: TestClient, make_user: MakeUser, role: UserRole, expected: int
) -> None:
    make_user("tester", role)
    login(client, "tester")
    assert client.get("/api/admin/users").status_code == expected
    new = {"username": "novy", "full_name": "Nový", "role": "operator", "password": "heslo-12345"}
    assert client.post("/api/admin/users", json=new).status_code == (
        201 if expected == 200 else 403
    )


@pytest.fixture
def admin_client(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("admin", UserRole.ADMIN)
    assert login(client, "admin") == 200
    return client


def test_admin_creates_user_who_can_log_in(admin_client: TestClient) -> None:
    resp = admin_client.post(
        "/api/admin/users",
        json={
            "username": "Nova.Op",
            "full_name": "Nová Operátorka",
            "role": "operator",
            "password": "heslo-12345",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["username"] == "nova.op"

    other = TestClient(admin_client.app)
    assert login(other, "nova.op", "heslo-12345") == 200
    assert other.get("/api/auth/me").json()["role"] == "operator"


def test_duplicate_username_is_conflict(admin_client: TestClient, make_user: MakeUser) -> None:
    make_user("jana")
    resp = admin_client.post(
        "/api/admin/users",
        json={
            "username": "jana",
            "full_name": "Iná Jana",
            "role": "courier",
            "password": "heslo-12345",
        },
    )
    assert resp.status_code == 409


@pytest.mark.parametrize(
    "body",
    [
        {"username": "x", "full_name": "Krátke meno", "role": "courier", "password": "heslo-12345"},
        {
            "username": "zle meno",
            "full_name": "Medzera",
            "role": "courier",
            "password": "heslo-12345",
        },
        {"username": "kratke", "full_name": "Krátke heslo", "role": "courier", "password": "123"},
        {"username": "rola", "full_name": "Zlá rola", "role": "boss", "password": "heslo-12345"},
    ],
)
def test_invalid_user_input_is_422(admin_client: TestClient, body: dict[str, str]) -> None:
    assert admin_client.post("/api/admin/users", json=body).status_code == 422


def test_admin_cannot_lock_themselves_out(admin_client: TestClient) -> None:
    me = admin_client.get("/api/auth/me").json()
    url = f"/api/admin/users/{me['id']}"
    assert admin_client.patch(url, json={"active": False}).status_code == 400
    assert admin_client.patch(url, json={"role": "courier"}).status_code == 400
    assert admin_client.patch(url, json={"full_name": "Nové Meno"}).status_code == 200


def test_deactivation_ends_sessions_and_blocks_login(
    admin_client: TestClient, make_user: MakeUser, db: Session
) -> None:
    user = make_user("kurier", UserRole.COURIER)
    courier = TestClient(admin_client.app)
    assert login(courier, "kurier") == 200

    resp = admin_client.patch(f"/api/admin/users/{user.id}", json={"active": False})
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    assert courier.get("/api/auth/me").status_code == 401
    assert db.execute(select(UserSession).where(UserSession.user_id == user.id)).first() is None
    assert login(TestClient(admin_client.app), "kurier") == 403


def test_password_reset_and_role_change(admin_client: TestClient, make_user: MakeUser) -> None:
    user = make_user("peter", UserRole.OPERATOR)
    resp = admin_client.patch(
        f"/api/admin/users/{user.id}", json={"password": "nove-heslo-99", "role": "security"}
    )
    assert resp.status_code == 200
    other = TestClient(admin_client.app)
    assert login(other, "peter") == 401
    assert login(other, "peter", "nove-heslo-99") == 200
    assert other.get("/api/auth/me").json()["role"] == "security"


def test_patch_unknown_user_is_404(admin_client: TestClient) -> None:
    assert (
        admin_client.patch("/api/admin/users/99999", json={"full_name": "Nikto"}).status_code == 404
    )
