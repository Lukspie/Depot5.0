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
    direction="BA", kind="inbound", weekday=3, month=11, hour=1, weather="snow", prev_delay_min=20
)


@pytest.fixture(autouse=True)
def weather(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(telematics, "weather_of", lambda day: "rain")


def test_the_trained_model_loads_and_predicts() -> None:
    model = delay_model()
    assert model is not None, "ml/artifacts/delay_model.joblib missing: run ml/train_delay.py"
    assert "BA" in model.directions
    assert model.metrics["maeMin"] < model.metrics["maeBaselineMin"]
    [snowy] = model.predict([SAMPLE])
    [clear] = model.predict(
        [DelayFeatures(**{**SAMPLE.__dict__, "weather": "clear", "prev_delay_min": 0})]
    )
    assert -30 < clear < snowy < 240  # snow and a late yesterday make it later


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
