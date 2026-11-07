"""Predictive maintenance of the dock scanners (phase 6, PROMPT §8.4, ADR-058).

An IsolationForest learns what a healthy scanner looks like in 10-minute buckets (read rate over
the last 30 min and 2 h and how many standard errors each lies under the reference rate, so a low
rate from a handful of items counts less than the same rate from a full wave). A bucket that looks
unusual AND reads worse than a healthy scanner raises the risk; at the threshold the app opens
the alert "klesajúca čítanosť, skontrolovať optiku". The bucket features are computed here for
both the training script (`ml/train_scanner.py`) and the app job, from the same 10-minute buckets
telematics serves.
"""

import logging
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import sklearn

from depotrack.ml.delay import artifacts_dir

log = logging.getLogger(__name__)

ARTIFACT = "scanner_model.joblib"
SHORT = 3  # buckets of 10 min = 30 min
LONG = 12  # 2 h
MIN_ITEMS = 20  # fewer items in 30 min: the scanner is idle, no score
# the alert needs this many consecutive 10-min buckets over the threshold: noise does not persist,
# a dirty optics does (ADR-058)
PERSIST = 2
FEATURES = ("z_30m", "z_2h")
# reference read rate of a healthy dock scanner (simulator defaults 0.94-0.97, ADR-024)
REFERENCE = 0.95


@dataclass(frozen=True)
class Bucket:
    items: int
    reads_ok: int


def _z(rate: float, items: int) -> float:
    """Standard errors under the reference rate (binomial), positive when worse."""
    return (REFERENCE - rate) * math.sqrt(items / (REFERENCE * (1 - REFERENCE)))


@dataclass(frozen=True)
class ScannerFeatures:
    rate_30m: float
    rate_2h: float
    items_30m: int
    items_2h: int

    def vector(self) -> list[float]:
        return [_z(self.rate_30m, self.items_30m), _z(self.rate_2h, self.items_2h)]


def bucket_features(buckets: list[Bucket]) -> ScannerFeatures | None:
    """Features of the latest bucket from the active buckets so far (oldest first)."""
    active = [b for b in buckets if b.items > 0]
    short, long = active[-SHORT:], active[-LONG:]
    items_short = sum(b.items for b in short)
    if items_short < MIN_ITEMS:
        return None
    items_long = sum(b.items for b in long)
    rate_short = sum(b.reads_ok for b in short) / items_short
    rate_long = sum(b.reads_ok for b in long) / items_long
    return ScannerFeatures(rate_short, rate_long, items_short, items_long)


@dataclass(frozen=True)
class ScannerModel:
    model: Any
    threshold: float  # anomaly score at which the alert opens
    median_score: float  # typical score of a healthy scanner (risk 0 %)
    healthy_rate: float  # median 30-min read rate of a healthy scanner
    metrics: dict[str, Any]

    def score(self, f: ScannerFeatures) -> float:
        """Anomaly score (higher = more unusual); a scanner reading better than a healthy one is
        unusual but not at risk, so its score is capped at the healthy median."""
        raw = float(-self.model.score_samples(np.array([f.vector()]))[0])
        return raw if f.rate_30m < self.healthy_rate else min(raw, self.median_score)

    def alarm(self, buckets: list[Bucket]) -> bool:
        """The latest PERSIST buckets (each with the buckets before it) all over the threshold."""
        for k in range(PERSIST):
            f = bucket_features(buckets[: len(buckets) - k] if k else buckets)
            if f is None or self.score(f) < self.threshold:
                return False
        return True

    def risk(self, score: float) -> float:
        """0 = like a healthy scanner, 1 = at the alert threshold (capped at 1)."""
        span = self.threshold - self.median_score
        return 0.0 if span <= 0 else max(0.0, min(1.0, (score - self.median_score) / span))


def load_scanner_model(path: Path | None = None) -> ScannerModel | None:
    file = path or artifacts_dir() / ARTIFACT
    if not file.exists():
        log.warning("scanner model %s not found, predictive maintenance disabled", file)
        return None
    try:
        data = joblib.load(file)  # our own artifact from the repository (ml/train_scanner.py)
    except Exception:
        log.exception("cannot load scanner model %s", file)
        return None
    if data.get("sklearn") != sklearn.__version__:
        log.warning("scanner model saved with scikit-learn %s: retrain", data.get("sklearn"))
        return None
    return ScannerModel(
        model=data["model"],
        threshold=float(data["threshold"]),
        median_score=float(data["median_score"]),
        healthy_rate=float(data["healthy_rate"]),
        metrics=dict(data["metrics"]),
    )


@lru_cache
def scanner_model() -> ScannerModel | None:
    return load_scanner_model()
