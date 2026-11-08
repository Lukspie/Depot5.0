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
    # the one deliberate change (ADR-065): the linehaul ZA ends in the Žilina depot, not in a point
    # of the town; the evening-peak golden of the simulator stays equal (telematics/tests)
    assert now["plan"]["destinations"].pop("ZA") != golden["plan"]["destinations"].pop("ZA")
    # new in phase 7c: which depot the trucks of a direction end in (for the gates of the depots)
    assert now["plan"].pop("destinationDepots") == {"BA": "BAH", "ZA": "ZIL"}
    assert now["plan"] == golden["plan"]
    assert now["manifests"] == golden["manifests"]
    # other depots add routes, and every route gained its depot and van places (ADR-065):
    # Budimír's routes must equal the golden ones in everything they had before
    routes = {r["routeId"]: r for r in now["courierRoutes"]["routes"]}
    for old in golden["courierRoutes"]["routes"]:
        new = routes[old["routeId"]]
        assert {k: new[k] for k in old} == old
        assert new["depot"]["code"] == "BUD"
    assert {k: v for k, v in now["courierRoutes"].items() if k != "routes"} == {
        k: v for k, v in golden["courierRoutes"].items() if k != "routes"
    }
