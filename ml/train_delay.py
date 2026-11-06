"""Train the truck delay model (phase 6, PROMPT §8.3, ADR-057).

Data:   ml/data/trips_history.csv  (cd telematics && npm run gen:history -- --days 180 --out ../ml/data)
Output: ml/artifacts/delay_model.joblib + delay_model.json (metrics)

Runs inside the app image, so training and inference use the same scikit-learn and the same
feature encoding (depotrack.ml.delay):

    docker compose run --rm --no-deps -v "$PWD/ml:/app/ml" app python ml/train_delay.py

Split by time: the last 30 days are the test set. Baseline = mean delay per (direction, kind) of the
training days. After the evaluation the model is refitted on all days for the app.
"""

import csv
import json
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor

from depotrack.ml.delay import ARTIFACT, CATEGORICAL, FEATURES, DelayFeatures, encode

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "trips_history.csv"
OUT = ROOT / "artifacts"
TEST_DAYS = 30
SEED = 42


def load() -> tuple[list[date], list[DelayFeatures], list[float]]:
    days, rows, y = [], [], []
    with DATA.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            days.append(date.fromisoformat(r["operating_day"]))
            rows.append(
                DelayFeatures(
                    direction=r["direction"],
                    kind=r["kind"],
                    weekday=int(r["weekday"]),
                    month=int(r["month"]),
                    hour=int(r["hour"]),
                    weather=r["weather"],
                    prev_delay_min=float(r["prev_delay_min"]),
                )
            )
            y.append(float(r["delay_min"]))
    return days, rows, y


def model() -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss="absolute_error",  # the metric is MAE
        categorical_features=list(CATEGORICAL),
        max_iter=300,
        learning_rate=0.05,
        max_leaf_nodes=15,
        min_samples_leaf=20,
        random_state=SEED,
    )


def main() -> None:
    if not DATA.exists():
        sys.exit(f"missing {DATA}: run `npm run gen:history -- --days 180 --out ../ml/data` in telematics")
    days, rows, y_all = load()
    directions = tuple(sorted({r.direction for r in rows}))
    x_all = encode(rows, directions)
    y = np.array(y_all)
    cut = max(days) - timedelta(days=TEST_DAYS - 1)
    train = np.array([d < cut for d in days])
    test = ~train

    # baseline: mean delay per (direction, kind) on the training days
    sums: dict[tuple[str, str], list[float]] = defaultdict(list)
    for r, v, is_train in zip(rows, y_all, train, strict=True):
        if is_train:
            sums[(r.direction, r.kind)].append(v)
    mean = {k: float(np.mean(v)) for k, v in sums.items()}
    baseline = np.array([mean.get((r.direction, r.kind), 0.0) for r in rows])

    m = model().fit(x_all[train], y[train])
    pred = m.predict(x_all[test])
    mae = float(np.mean(np.abs(pred - y[test])))
    mae_base = float(np.mean(np.abs(baseline[test] - y[test])))
    per_kind = {
        kind: {
            "mae": round(float(np.mean(np.abs(pred[sel] - y[test][sel]))), 2),
            "maeBaseline": round(float(np.mean(np.abs(baseline[test][sel] - y[test][sel]))), 2),
        }
        for kind in ("inbound", "outbound")
        if (sel := np.array([r.kind == kind for r, t in zip(rows, test, strict=True) if t])).any()
    }

    final = model().fit(x_all, y)
    metrics = {
        "model": "HistGradientBoostingRegressor(loss=absolute_error)",
        "features": list(FEATURES),
        "trainDays": int(len({d for d, t in zip(days, train, strict=True) if t})),
        "testDays": TEST_DAYS,
        "rowsTrain": int(train.sum()),
        "rowsTest": int(test.sum()),
        "maeMin": round(mae, 2),
        "maeBaselineMin": round(mae_base, 2),
        "improvement": round(1 - mae / mae_base, 3) if mae_base else None,
        "perKind": per_kind,
        "data": {"from": min(days).isoformat(), "to": max(days).isoformat()},
        "sklearn": sklearn.__version__,
    }
    OUT.mkdir(exist_ok=True)
    joblib.dump({"model": final, "directions": list(directions), "metrics": metrics, "sklearn": sklearn.__version__}, OUT / ARTIFACT)
    (OUT / "delay_model.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
