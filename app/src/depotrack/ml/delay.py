"""Truck delay prediction (phase 6, PROMPT §8.3, ADR-057).

One HistGradientBoostingRegressor predicts the delay in minutes of a planned event (arrival of an
inbound trip, departure of an outbound one) from: direction, kind, weekday, month, hour, simulated
weather and the delay of the same trip the day before. The feature encoding lives here and is used
by the training script (`ml/train_delay.py`, run inside the app image) and by the inference, so
both always encode the same way.
"""

import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import sklearn

from depotrack.core.config import get_settings

log = logging.getLogger(__name__)

ARTIFACT = "delay_model.joblib"
WEATHER = ("clear", "rain", "fog", "snow")
KINDS = ("inbound", "outbound")
FEATURES = ("direction", "kind", "weekday", "month", "hour", "weather", "prev_delay_min")
CATEGORICAL = (True, True, False, False, False, True, False)


@dataclass(frozen=True)
class DelayFeatures:
    direction: str
    kind: str
    weekday: int  # 0 = Sunday … 6 = Saturday (local time, as telematics localParts)
    month: int
    hour: int
    weather: str
    prev_delay_min: float


def encode(
    rows: list[DelayFeatures], directions: tuple[str, ...]
) -> np.ndarray[Any, np.dtype[np.float64]]:
    """Feature matrix; unknown categories become NaN (the model treats them as missing)."""

    def index(values: tuple[str, ...], v: str) -> float:
        return float(values.index(v)) if v in values else float("nan")

    return np.array(
        [
            [
                index(directions, r.direction),
                index(KINDS, r.kind),
                float(r.weekday),
                float(r.month),
                float(r.hour),
                index(WEATHER, r.weather),
                float(r.prev_delay_min),
            ]
            for r in rows
        ],
        dtype=np.float64,
    )


@dataclass(frozen=True)
class DelayModel:
    model: Any
    directions: tuple[str, ...]
    metrics: dict[str, Any]

    def predict(self, rows: list[DelayFeatures]) -> list[float]:
        if not rows:
            return []
        return [float(x) for x in self.model.predict(encode(rows, self.directions))]


def artifacts_dir() -> Path:
    return Path(get_settings().ml_artifacts_dir)


def load_delay_model(path: Path | None = None) -> DelayModel | None:
    """The trained model, or None when the artifact is missing or was saved by another
    scikit-learn version (the app then runs without ML ETA and the UI says "model nedostupný")."""
    file = path or artifacts_dir() / ARTIFACT
    if not file.exists():
        log.warning("delay model %s not found, ML ETA disabled", file)
        return None
    try:
        data = joblib.load(file)  # our own artifact from the repository (ml/train_delay.py)
    except Exception:
        log.exception("cannot load delay model %s", file)
        return None
    if data.get("sklearn") != sklearn.__version__:
        log.warning(
            "delay model saved with scikit-learn %s, running %s: retrain",
            data.get("sklearn"),
            sklearn.__version__,
        )
        return None
    return DelayModel(
        model=data["model"], directions=tuple(data["directions"]), metrics=dict(data["metrics"])
    )


@lru_cache
def delay_model() -> DelayModel | None:
    return load_delay_model()


def model_card(name: str) -> dict[str, Any] | None:
    """Metrics written next to the artifact (ml/artifacts/<name>.json), for the status endpoint."""
    file = artifacts_dir() / f"{name}.json"
    if not file.exists():
        return None
    result: dict[str, Any] = json.loads(file.read_text(encoding="utf-8"))
    return result
