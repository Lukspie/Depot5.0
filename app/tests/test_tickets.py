"""WebSocket tickets and the admin-everywhere rule (ADR-017)."""

import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from conftest import MakeUser, login
from depotrack.core.rbac import require_role
from depotrack.models.enums import UserRole


def test_ws_ticket_requires_login(client: TestClient) -> None:
    assert client.post("/api/auth/ws-ticket").status_code == 401


def test_ws_ticket_is_short_lived_signed_jwt_with_role(
    client: TestClient, make_user: MakeUser
) -> None:
    make_user("operator1", UserRole.OPERATOR)
    login(client, "operator1")
    resp = client.post("/api/auth/ws-ticket")
    assert resp.status_code == 200
    body = resp.json()
    assert body["expiresIn"] == 60
    assert body["wsUrl"] == "ws://localhost:8080/ws"

    claims = jwt.decode(
        body["ticket"],
        "test-ws-secret-0123456789abcdef0123456789",
        algorithms=["HS256"],
        audience="telematics",
        issuer="depotrack-app",
    )
    assert claims["role"] == "operator"
    assert claims["name"] == "operator1"
    # bound to the home depot (Budimír without one); dispatchers get null (ADR-068)
    assert claims["depot"] == "BUD"
    assert claims["exp"] - claims["iat"] == 60
    assert len(claims["jti"]) == 32

    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(
            body["ticket"],
            "other-secret-0123456789abcdef01234567",
            algorithms=["HS256"],
            audience="telematics",
        )


def test_each_ticket_is_unique(client: TestClient, make_user: MakeUser) -> None:
    make_user("jana")
    login(client, "jana")
    assert (
        client.post("/api/auth/ws-ticket").json()["ticket"]
        != client.post("/api/auth/ws-ticket").json()["ticket"]
    )


def test_admin_passes_every_role_check(make_user: MakeUser) -> None:
    admin = make_user("admin", UserRole.ADMIN)
    operator = make_user("op", UserRole.OPERATOR)
    only_dispatchers = require_role(UserRole.DISPATCHER)
    assert only_dispatchers(admin) is admin
    with pytest.raises(HTTPException) as exc:
        only_dispatchers(operator)
    assert exc.value.status_code == 403
