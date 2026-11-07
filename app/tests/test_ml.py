"""Phase 6 ML (ADR-057): delay model loading, inference endpoints, ML arrival prediction."""

from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.ml import delay as delay_module
from depotrack.ml.delay import DelayFeatures, delay_model, load_delay_model
from depotrack.models import Trip
from depotrack.models.enums import UserRole
from depotrack.services import telematics
from depotrack.services.ml_eta import ML, TELEMATICS, refresh_ml_eta
from test_wms import TOKEN, at_time, local, seeded, trip

__all__ = ["at_time", "seeded"]  # fixtures shared with test_wms

SAMPLE = DelayFeatures(
    direction="BA", kind="inbound", weekday=3, month=1, hour=1, weather="snow", prev_delay_min=20
)


@pytest.fixture(autouse=True)
def weather(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(telematics, "weather_of", lambda day: "rain")


def test_the_trained_model_loads_and_predicts() -> None:
    model = delay_model()
    assert model is not None, "ml/artifacts/delay_model.joblib missing: run ml/train_delay.py"
    assert "BA" in model.directions
    assert model.metrics["maeMin"] < model.metrics["maeBaselineMin"]
    # one feature at a time: snow alone makes the night truck later than a clear night
    [snowy] = model.predict([SAMPLE])
    [clear] = model.predict([DelayFeatures(**{**SAMPLE.__dict__, "weather": "clear"})])
    assert -30 < clear < snowy < 240, (clear, snowy)
    [late_yesterday] = model.predict([DelayFeatures(**{**SAMPLE.__dict__, "prev_delay_min": 90})])
    assert late_yesterday > snowy


@pytest.mark.usefixtures("seeded", "at_time")
def test_inference_encodes_the_weekday_like_the_history(db: Session) -> None:
    """History (telematics localParts): 0 = Sunday … 6 = Saturday; the app must not use 1-7."""
    from depotrack.services.ml_eta import features

    night = trip(
        db, "BA", "inbound"
    )  # DAY 2026-10-23 is a Friday, the night truck arrives Saturday
    f = features(db, night, "clear")
    assert f is not None and f.weekday == 6 and f.hour == 1 and f.month == 10


def test_weather_comes_from_the_telematics_scenario(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /sim/scenario answers {"days": [{"day", "weather", ...}]}."""
    import importlib

    from depotrack.services import telematics as real

    importlib.reload(real)  # undo the autouse stub for this test

    class Resp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"days": [{"day": "2026-10-23", "weather": "snow", "seed": 42}]}

    monkeypatch.setattr(real.httpx, "get", lambda *a, **k: Resp())
    monkeypatch.setattr(real, "_weather_cache", None)
    from datetime import date

    assert real.weather_of(date(2026, 10, 23)) == "snow"
    assert real.weather_of(date(2026, 10, 24)) is None


def test_a_missing_artifact_is_not_an_error(tmp_path: Path) -> None:
    assert load_delay_model(tmp_path / "nope.joblib") is None


def test_status_endpoint_for_staff_only(client: TestClient, make_user: MakeUser) -> None:
    make_user("op", UserRole.OPERATOR)
    login(client, "op")
    body = client.get("/api/ml/status").json()
    delay = next(m for m in body["models"] if m["name"] == "delay")
    assert delay["available"] is True and delay["metrics"]["maeMin"] > 0
    make_user("kur", UserRole.COURIER)
    login(client, "kur")
    assert client.get("/api/ml/status").status_code == 403


@pytest.mark.usefixtures("seeded", "at_time")
def test_delay_prediction_of_a_trip_over_http(
    client: TestClient, make_user: MakeUser, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    night = trip(db, "BA", "inbound")
    make_user("guard", UserRole.SECURITY)
    login(client, "guard")
    assert client.get(f"/api/ml/delay/trips/{night.id}").status_code == 403
    make_user("disp", UserRole.DISPATCHER)
    login(client, "disp")
    res = client.get(f"/api/ml/delay/trips/{night.id}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["weather"] == "rain" and body["features"]["direction"] == "BA"
    assert body["kind"] == "inbound" and isinstance(body["predictedDelayMin"], float)
    assert client.get("/api/ml/delay/trips/999999").status_code == 404
    monkeypatch.setattr(delay_module, "delay_model", lambda: None)
    import depotrack.api.ml as api_ml

    monkeypatch.setattr(api_ml, "delay_model", lambda: None)
    assert client.get(f"/api/ml/delay/trips/{night.id}").status_code == 503


@pytest.mark.usefixtures("seeded", "at_time")
def test_ml_eta_for_planned_trips_until_telematics_predicts(
    client: TestClient, db: Session
) -> None:
    model = delay_model()
    assert model is not None
    night = trip(db, "BA", "inbound")
    changed, _alerts = refresh_ml_eta(
        db, model, night.operating_day, "clear", local(18, 0), timedelta(minutes=30)
    )
    db.commit()
    assert changed >= 1
    db.refresh(night)
    assert night.predicted_by == ML and night.predicted_arrival is not None
    ml_eta = night.predicted_arrival

    def send(status: str, predicted: str | None) -> None:
        ev = {
            "tripId": night.id,
            "status": status,
            "actualArrival": None,
            "actualDeparture": None,
            "predictedArrival": predicted,
        }
        body = {"simTime": local(19, 0).isoformat(), "trips": [ev]}
        assert client.post("/internal/events/trips", json=body, headers=TOKEN).status_code == 200

    # telematics without its own prediction keeps the ML one
    send("en_route", None)
    db.expire_all()
    assert db.get(Trip, night.id).predicted_arrival == ml_eta  # type: ignore[union-attr]
    # telematics with a prediction (position, breakdown) wins and the model stops touching it
    tele = (local(23, 0) + timedelta(hours=3)).isoformat()
    send("en_route", tele)
    db.expire_all()
    t = db.get(Trip, night.id)
    assert t is not None and t.predicted_by == TELEMATICS
    refresh_ml_eta(db, model, night.operating_day, "clear", local(19, 5), timedelta(minutes=30))
    assert t.predicted_by == TELEMATICS


# ---------------------------------------------------------- predictive maintenance (ADR-058)


def _wave(rates: list[float], items: int = 10) -> list[dict[str, object]]:
    """Telematics buckets of a dock scanner: ~1 item/min as in the live simulator; the read counts
    carry the rounding over, so the mean read rate is exact."""
    out, carry = [], 0.0
    for i, r in enumerate(rates):
        exact = items * r + carry
        ok = int(exact)
        carry = exact - ok
        out.append({"at": f"b{i}", "items": items, "readRate": ok / items})
    return out


def _first_alarm(model: object, rates: list[float]) -> int | None:
    from depotrack.ml.scanner import ScannerModel
    from depotrack.services.ml_scanner import to_buckets

    assert isinstance(model, ScannerModel)
    buckets = to_buckets(_wave(rates))
    return next((i for i in range(1, len(buckets) + 1) if model.alarm(buckets[:i])), None)


def test_the_guaranteed_degradation_of_the_seed_is_caught() -> None:
    """SIM_DEGRADED_DEVICE loses read rate 0.97 -> 0.85 in 6 h from 15:30 (ADR-024): the evening
    wave of its dock (17:05-21:15, 25 buckets) must raise the alert; healthy scanners never do."""
    from depotrack.ml.scanner import scanner_model

    model = scanner_model()
    assert model is not None, "ml/artifacts/scanner_model.joblib missing: run ml/train_scanner.py"
    evening = [0.97 - 0.12 * (95 + 10 * i) / 360 for i in range(25)]
    hit = _first_alarm(model, evening)
    assert hit is not None and 6 <= hit <= 25, hit  # not in the first hour, within the wave
    for healthy in (0.97, 0.95, 0.94, 0.93):
        noise = [
            healthy + (0.02 if i % 3 == 0 else -0.02 if i % 3 == 1 else 0.0) for i in range(36)
        ]
        assert _first_alarm(model, noise) is None, healthy
    # a scanner reading better than usual is unusual, but not at risk
    assert _first_alarm(model, [1.0] * 36) is None


@pytest.mark.usefixtures("seeded", "at_time")
def test_scanner_job_opens_and_closes_the_alert(db: Session) -> None:
    from depotrack.ml.scanner import scanner_model
    from depotrack.models import Alert
    from depotrack.models.enums import AlertKind
    from depotrack.services.ml_scanner import LATEST, score_scanners

    model = scanner_model()
    assert model is not None
    devices = [
        {"code": "DOCK-SCN-02", "kind": "dock_scanner", "doorCode": "LD-02"},
        {"code": "DOCK-SCN-05", "kind": "dock_scanner", "doorCode": "LD-05"},
        {"code": "DOOR-SNS-02", "kind": "door_sensor", "doorCode": "LD-02"},
    ]
    bad = _wave([0.96] * 4 + [0.80] * 8, items=22)  # optics clearly dirty
    good = _wave([0.96] * 12, items=22)
    metrics = {"DOCK-SCN-02": bad, "DOCK-SCN-05": good}
    changes = score_scanners(db, model, devices, lambda code: metrics.get(code), local(21, 0))
    db.commit()
    assert [c.alert.ref_id for c in changes] == ["DOCK-SCN-02"]
    alert = db.query(Alert).filter(Alert.kind == AlertKind.SCANNER_DEGRADATION).one()
    assert "LD-02" in alert.message and "optiku" in alert.message
    assert LATEST["DOCK-SCN-02"].alarm and LATEST["DOCK-SCN-02"].risk == 1.0
    assert not LATEST["DOCK-SCN-05"].alarm and "DOOR-SNS-02" not in LATEST
    # the optics were cleaned: the risk falls and the alert closes (system, no user)
    metrics["DOCK-SCN-02"] = good
    score_scanners(db, model, devices, lambda code: metrics.get(code), local(22, 0))
    db.commit()
    db.refresh(alert)
    assert alert.acknowledged_at is not None and alert.acknowledged_by is None


def test_scanner_risks_endpoint_roles(client: TestClient, make_user: MakeUser) -> None:
    make_user("guard2", UserRole.SECURITY)
    login(client, "guard2")
    body = client.get("/api/ml/scanners").json()
    assert body["available"] is True and body["threshold"] > 0
    make_user("op2", UserRole.OPERATOR)
    login(client, "op2")
    assert client.get("/api/ml/scanners").status_code == 403
