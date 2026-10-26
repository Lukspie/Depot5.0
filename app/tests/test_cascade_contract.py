"""The cascade rule against the cases shared with telematics (contracts/cascade-cases.json)."""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from depotrack.services.cascade import cascade_risk


def _cases() -> list[dict[str, Any]]:
    here = Path(__file__).resolve()
    # in the image: /app/contracts, in the repository: <repo>/contracts
    for base in (here.parents[1], here.parents[2]):
        path = base / "contracts" / "cascade-cases.json"
        if path.exists():
            cases: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8"))["cases"]
            return cases
    raise FileNotFoundError("contracts/cascade-cases.json")


@pytest.mark.parametrize("case", _cases(), ids=lambda c: str(c["name"]))
def test_cascade_rule_matches_shared_cases(case: dict[str, Any]) -> None:
    risk = cascade_risk(
        datetime.fromisoformat(case["eta"]),
        datetime.fromisoformat(case["departure"]),
        timedelta(minutes=case["bufferMin"]),
    )
    expected = case["expected"]
    if expected is None:
        assert risk is None
    else:
        assert risk is not None
        assert (risk.severity.value, risk.late_min) == (expected["severity"], expected["lateMin"])
