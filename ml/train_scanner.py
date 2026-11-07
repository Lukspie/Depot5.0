"""Train the predictive maintenance model of the dock scanners (phase 6, PROMPT §8.4, ADR-058).

Data:   ml/data/device_metrics_history.csv  (npm run gen:history, minute metrics + episode labels)
Output: ml/artifacts/scanner_model.joblib + scanner_model.json (metrics)

    docker compose run --rm --no-deps -u root -v "$PWD/ml:/app/ml" app python ml/train_scanner.py

Minutes are summed into the same 10-minute buckets telematics serves to the app. The
IsolationForest learns from healthy buckets of the training days only (no labels needed); the
labels of the degradation episodes are used for the evaluation on the last 45 days and to check
that the alert fires before a scanner reaches the bad read rate.
"""

import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest

from depotrack.ml.scanner import (
    ARTIFACT,
    FEATURES,
    PERSIST,
    Bucket,
    ScannerFeatures,
    bucket_features,
)

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "device_metrics_history.csv"
OUT = ROOT / "artifacts"
TEST_DAYS = 45
SEED = 42
BUCKET = timedelta(minutes=10)
# a bucket counts as "degraded" for the evaluation once the read rate fell 4 points under normal
VISIBLE_DROP = 0.04
# alert threshold: this quantile of the healthy scores (below the median rate), with PERSIST
# consecutive buckets; catches the seed degradation in its first evening wave (ADR-058)
QUANTILE = float(os.environ.get("SCANNER_QUANTILE", "0.98"))


def load() -> dict[str, list[tuple[datetime, Bucket, bool]]]:
    """device -> 10-minute buckets (start, counts, any degraded minute) in time order."""
    raw: dict[tuple[str, datetime], list[int]] = defaultdict(lambda: [0, 0, 0])
    with DATA.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r["device"].startswith("DOCK-SCN"):  # door sensors never scan (ADR-050)
                continue
            minute = datetime.fromisoformat(r["minute"].replace("Z", "+00:00"))
            start = minute - timedelta(minutes=minute.minute % 10)
            acc = raw[(r["device"], start)]
            acc[0] += int(r["items"])
            acc[1] += int(r["reads_ok"])
            acc[2] |= int(r["degraded"])
    out: dict[str, list[tuple[datetime, Bucket, bool]]] = defaultdict(list)
    for (device, start), (items, ok, deg) in sorted(raw.items()):
        out[device].append((start, Bucket(items, ok), bool(deg)))
    return out


def rows(
    series: list[tuple[datetime, Bucket, bool]],
) -> list[tuple[datetime, ScannerFeatures, bool]]:
    """Features of every bucket from the buckets before it; a gap > 4 h (between waves) restarts
    the window, as the live scanner sees one wave at a time."""
    result = []
    window: list[Bucket] = []
    last: datetime | None = None
    for start, bucket, degraded in series:
        if last is not None and start - last > timedelta(hours=4):
            window = []
        window.append(bucket)
        last = start
        f = bucket_features(window)
        if f is not None:
            result.append((start, f, degraded))
    return result


def main() -> None:
    if not DATA.exists():
        sys.exit(
            f"missing {DATA}: in telematics run "
            "`npm run gen:history -- --out ../ml/data`"
        )
    series = load()
    all_rows = {d: rows(s) for d, s in series.items()}
    end = max(r[0] for rs in all_rows.values() for r in rs)
    cut = end - timedelta(days=TEST_DAYS)

    train_healthy = [f for rs in all_rows.values() for (t, f, deg) in rs if t < cut and not deg]
    x_train = np.array([f.vector() for f in train_healthy])
    model = IsolationForest(n_estimators=300, contamination="auto", random_state=SEED).fit(x_train)
    healthy_scores = -model.score_samples(x_train)
    healthy_rate = float(np.median([f.rate_30m for f in train_healthy]))
    below = healthy_scores[np.array([f.rate_30m < healthy_rate for f in train_healthy])]
    threshold = float(np.quantile(below, QUANTILE))
    median_score = float(np.median(healthy_scores))

    def score(f: ScannerFeatures) -> float:
        raw = float(-model.score_samples(np.array([f.vector()]))[0])
        return raw if f.rate_30m < healthy_rate else min(raw, median_score)

    # evaluation on the test days: buckets and degradation episodes
    tp = fp = fn = tn = 0
    episodes = detected = 0
    delays: list[float] = []
    for rs in all_rows.values():
        in_episode = False
        episode_start: datetime | None = None
        caught = False
        over = 0  # consecutive buckets over the threshold (the app needs PERSIST of them)
        for t, f, deg in rs:
            if t < cut:
                continue
            over = over + 1 if score(f) >= threshold else 0
            alarm = over >= PERSIST
            visible = deg and f.rate_30m <= healthy_rate - VISIBLE_DROP
            if visible and alarm:
                tp += 1
            elif visible:
                fn += 1
            elif not deg and alarm:
                fp += 1
            elif not deg:
                tn += 1
            if deg and not in_episode:
                in_episode, episode_start, caught = True, t, False
                episodes += 1
            if not deg and in_episode:
                in_episode = False
            if in_episode and alarm and not caught and episode_start is not None:
                caught = True
                detected += 1
                delays.append((t - episode_start).total_seconds() / 3600)
    metrics = {
        "model": "IsolationForest(n_estimators=300) on healthy 10-min buckets",
        "features": list(FEATURES),
        "testDays": TEST_DAYS,
        "trainBuckets": len(train_healthy),
        "threshold": round(threshold, 4),
        "healthyRate": round(healthy_rate, 4),
        "bucketRecall": round(tp / (tp + fn), 3) if tp + fn else None,
        "bucketPrecision": round(tp / (tp + fp), 3) if tp + fp else None,
        "falseAlarmRate": round(fp / (fp + tn), 4) if fp + tn else None,
        "episodes": episodes,
        "episodesDetected": detected,
        "medianDetectionDelayH": round(float(np.median(delays)), 1) if delays else None,
        "sklearn": sklearn.__version__,
    }
    OUT.mkdir(exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "threshold": threshold,
            "median_score": median_score,
            "healthy_rate": healthy_rate,
            "metrics": metrics,
            "sklearn": sklearn.__version__,
        },
        OUT / ARTIFACT,
    )
    (OUT / "scanner_model.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
