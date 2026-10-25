"""Smoke tests for system endpoints. Run inside the stack: docker compose run --rm app pytest"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from depotrack.core.spa import mount_spa
from depotrack.main import create_app

client = TestClient(create_app())


def test_hello() -> None:
    resp = client.get("/api/hello")
    assert resp.status_code == 200
    body = resp.json()
    assert body["service"] == "app"
    assert "Python" in body["language"]


def test_public_config_exposes_telematics_url() -> None:
    resp = client.get("/api/config")
    assert resp.status_code == 200
    assert resp.json()["telematics_url"].startswith("http")


def test_health_reaches_database() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "db": "ok"}


def test_spa_fallback_and_api_404(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html>spa</html>")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    app = FastAPI()
    mount_spa(app, tmp_path)
    c = TestClient(app)

    assert c.get("/fleet").text == "<html>spa</html>"
    assert c.get("/favicon.svg").text == "<svg/>"
    assert c.get("/api/does-not-exist").status_code == 404
    # path traversal must not escape the static dir
    assert c.get("/..%2F..%2Fetc%2Fpasswd").text == "<html>spa</html>"
