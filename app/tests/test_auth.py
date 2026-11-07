"""Login, logout, sessions, CSRF origin check, rate limiting."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from conftest import TEST_PASSWORD, MakeUser, login
from depotrack.core.config import get_settings
from depotrack.core.security import token_hash
from depotrack.models import UserSession
from depotrack.models.enums import UserRole

COOKIE = "depotrack_session"


def test_login_sets_httponly_strict_cookie_and_me_works(
    client: TestClient, make_user: MakeUser
) -> None:
    make_user("jana", UserRole.DISPATCHER)
    resp = client.post("/api/auth/login", json={"username": "jana", "password": TEST_PASSWORD})
    assert resp.status_code == 200
    assert resp.json()["role"] == "dispatcher"
    assert "password_hash" not in resp.json()

    set_cookie = resp.headers["set-cookie"].lower()
    assert f"{COOKIE}=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie
    assert f"max-age={8 * 3600}" in set_cookie

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "jana"


def test_username_is_case_insensitive(client: TestClient, make_user: MakeUser) -> None:
    make_user("jana")
    assert login(client, "  Jana ") == 200


def test_wrong_password_and_unknown_user_give_same_401(
    client: TestClient, make_user: MakeUser
) -> None:
    make_user("jana")
    bad_pw = client.post("/api/auth/login", json={"username": "jana", "password": "zle-heslo"})
    unknown = client.post("/api/auth/login", json={"username": "nikto", "password": "zle-heslo"})
    assert bad_pw.status_code == unknown.status_code == 401
    assert bad_pw.json() == unknown.json()
    assert COOKIE not in client.cookies


def test_disabled_account_cannot_log_in(client: TestClient, make_user: MakeUser) -> None:
    make_user("peter", active=False)
    assert login(client, "peter") == 403


def test_session_is_stored_only_as_hash(
    client: TestClient, make_user: MakeUser, db: Session
) -> None:
    make_user("jana")
    login(client, "jana")
    token = client.cookies[COOKIE]
    ids = db.execute(select(UserSession.id)).scalars().all()
    assert ids == [token_hash(token)]
    assert token not in ids


def test_logout_deletes_session_and_old_cookie_stops_working(
    client: TestClient, make_user: MakeUser, db: Session
) -> None:
    make_user("jana")
    login(client, "jana")
    stolen = client.cookies[COOKIE]

    assert client.post("/api/auth/logout").status_code == 204
    assert db.execute(select(UserSession)).first() is None
    assert client.get("/api/auth/me").status_code == 401

    # replaying the old cookie must not work
    replay = TestClient(client.app, cookies={COOKIE: stolen})
    assert replay.get("/api/auth/me").status_code == 401


def test_expired_session_is_rejected(client: TestClient, make_user: MakeUser, db: Session) -> None:
    make_user("jana")
    login(client, "jana")
    db.execute(update(UserSession).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    db.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_forged_cookie_is_rejected(client: TestClient) -> None:
    forged = TestClient(client.app, cookies={COOKIE: "nahodny-falosny-token"})
    assert forged.get("/api/auth/me").status_code == 401


def test_foreign_origin_is_blocked_for_state_changing_requests(
    client: TestClient, make_user: MakeUser
) -> None:
    make_user("jana")
    body = {"username": "jana", "password": TEST_PASSWORD}
    evil = client.post("/api/auth/login", json=body, headers={"Origin": "http://evil.example"})
    assert evil.status_code == 403
    ok = client.post("/api/auth/login", json=body, headers={"Origin": "http://localhost:8000"})
    assert ok.status_code == 200



def test_same_origin_from_the_lan_is_allowed(client: TestClient, make_user: MakeUser) -> None:
    """A phone in the same Wi-Fi opens http://<IP of the PC>:8000: Origin equals the Host."""
    make_user("jana")
    body = {"username": "jana", "password": TEST_PASSWORD}
    lan = {"Origin": "http://192.168.1.20:8000", "Host": "192.168.1.20:8000"}
    assert client.post("/api/auth/login", json=body, headers=lan).status_code == 200
    # another site pretending: its Origin does not match the Host the request went to
    spoof = {"Origin": "http://evil.example", "Host": "192.168.1.20:8000"}
    assert client.post("/api/auth/login", json=body, headers=spoof).status_code == 403
    other_port = {"Origin": "http://192.168.1.20:9999", "Host": "192.168.1.20:8000"}
    assert client.post("/api/auth/login", json=body, headers=other_port).status_code == 403


def test_login_is_rate_limited(client: TestClient, make_user: MakeUser) -> None:
    make_user("jana")
    settings = get_settings()
    original = settings.login_rate_limit
    settings.login_rate_limit = "3/minute"
    try:
        codes = [login(client, "jana", "zle-heslo") for _ in range(4)]
    finally:
        settings.login_rate_limit = original
    assert codes == [401, 401, 401, 429]
