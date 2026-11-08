"""Budimír gives the same plan as at the tag `pre-depots` (phase 7c: more depots, same Budimír).

The golden file was captured by running golden_bud.budimir_inputs on the code of the tag (git
worktree) against a clean database seeded for the same day. A difference means phase 7c changed
what the simulator of Budimír receives: fix the code, do not refresh the golden file.
"""

import json
from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from depotrack.core.config import get_settings
from depotrack.services.operating_day import run_seed
from golden_bud import GOLDEN_DAY, budimir_inputs

GOLDEN = Path(__file__).parent / "data" / "golden" / "bud_pre_depots_app.json"


def test_budimir_plan_equals_the_pre_depots_golden(db: Session, client: TestClient) -> None:
    run_seed(db, get_settings(), date.fromisoformat(GOLDEN_DAY))
    now = json.loads(json.dumps(budimir_inputs(client), ensure_ascii=False, sort_keys=True))
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert now["plan"] == golden["plan"]
    assert now["manifests"] == golden["manifests"]
    assert now["courierRoutes"] == golden["courierRoutes"]
