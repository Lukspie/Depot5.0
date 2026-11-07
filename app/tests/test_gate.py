"""Gate camera (phase 6, ADR-059): plate normalisation, detection and the HTTP endpoint.

tests/data/gate_truck_cc0.jpg: "Semi-trailer truck Severgazprom" by Georg Pik, Wikimedia Commons,
CC0 1.0 (public domain dedication), scaled to 960 px.
"""

from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.ml.gate import normalize_plate
from depotrack.models import Alert, Vehicle
from depotrack.models.enums import AlertKind, UserRole
from depotrack.services import telematics
from test_wms import at_time, seeded

__all__ = ["at_time", "seeded"]

TRUCK = (Path(__file__).parent / "data" / "gate_truck_cc0.jpg").read_bytes()


def plate_image(text: str) -> bytes:
    img = Image.new("RGB", (520, 120), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([4, 4, 515, 115], outline="black", width=4)
    draw.text((40, 18), text, fill="black", font=ImageFont.load_default(size=80))
    buf = BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.mark.parametrize(
    ("raw", "plate"),
    [
        ("KE-102LH", "KE-102LH"),
        ("SK KE 1O2 LH", "KE-102LH"),  # country code, spaces, O read instead of 0
        ("BA8Z1AB", "BA-821AB"),
        ("0A-123BC", "OA-123BC"),
        ("hello world", None),
        ("KE-10LH", None),
    ],
)
def test_slovak_plate_from_ocr_text(raw: str, plate: str | None) -> None:
    assert normalize_plate(raw) == plate


@pytest.fixture
def passages(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []

    def post(p: dict[str, Any]) -> bool:
        sent.append(p)
        return True

    monkeypatch.setattr(telematics, "post_gate_passage", post)
    return sent


@pytest.fixture
def guard(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("gate", UserRole.SECURITY)
    login(client, "gate")
    return client


def detect(client: TestClient, data: bytes, kind: str = "image/jpeg", **params: str) -> Any:
    return client.post(
        "/api/gate/detect", content=data, headers={"Content-Type": kind}, params=params
    )


@pytest.mark.usefixtures("seeded", "at_time")
def test_truck_photo_detected_and_recorded(
    guard: TestClient, passages: list[dict[str, Any]]
) -> None:
    res = detect(guard, TRUCK)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["vehicleType"] == "truck" and body["vehicles"][0]["confidence"] > 0.5
    assert body["plate"] is None and body["expected"] is False  # Russian lettering, no SK plate
    assert body["recorded"] is True
    assert passages == [
        {
            "direction": "in",
            "vehicleType": "truck",
            "plate": None,
            "plateConfidence": None,
            "expected": False,
        }
    ]


@pytest.mark.usefixtures("seeded", "at_time")
def test_fleet_plate_is_expected_unknown_plate_raises_an_alert(
    guard: TestClient, db: Session, passages: list[dict[str, Any]]
) -> None:
    fleet = db.execute(select(Vehicle).order_by(Vehicle.id)).scalars().first()
    assert fleet is not None
    known = detect(guard, plate_image(fleet.plate), "image/png", direction="out").json()
    assert known["plate"] == fleet.plate and known["expected"] is True
    assert known["fleetKind"] == str(fleet.kind) and passages[-1]["direction"] == "out"
    assert db.execute(select(Alert).where(Alert.kind == AlertKind.OTHER)).first() is None

    stranger = detect(guard, plate_image("ZA-999XY"), "image/png").json()
    assert stranger["plate"] == "ZA-999XY" and stranger["expected"] is False
    alert = db.execute(select(Alert).where(Alert.ref_type == "plate")).scalar_one()
    assert "ZA-999XY" in alert.message
    # record=false only reads, nothing goes to telematics
    before = len(passages)
    assert (
        detect(guard, plate_image("ZA-999XY"), "image/png", record="false").json()["recorded"]
        is False
    )
    assert len(passages) == before


@pytest.mark.usefixtures("seeded", "at_time")
def test_gate_endpoint_roles_and_bad_input(
    client: TestClient,
    make_user: MakeUser,
    monkeypatch: pytest.MonkeyPatch,
    passages: list[dict[str, Any]],
) -> None:
    make_user("disp", UserRole.DISPATCHER)
    login(client, "disp")
    assert detect(client, TRUCK).status_code == 403
    make_user("gate2", UserRole.SECURITY)
    login(client, "gate2")
    assert detect(client, TRUCK, "text/plain").status_code == 415
    assert detect(client, b"not an image").status_code == 400
    assert detect(client, b"").status_code == 400
    import depotrack.api.gate as api_gate

    monkeypatch.setattr(api_gate, "gate_models", lambda: None)
    assert detect(client, TRUCK).status_code == 503
