"""Golden output of Budimír (phase 7c): the plan the app gives telematics for a fixed day.

Captured from the tag `pre-depots` (scripts in tests/test_golden_bud.py); phase 7c must not change
it. The simulator side is checked against the same inputs in telematics/tests/golden.test.ts.
"""

from typing import Any

from fastapi.testclient import TestClient

GOLDEN_DAY = "2026-10-23"
TOKEN = {"X-Service-Token": "test-service-token"}


def budimir_inputs(client: TestClient) -> dict[str, Any]:
    plan = client.get(f"/internal/plan?day={GOLDEN_DAY}", headers=TOKEN).json()
    directions = sorted(
        {t["directionCode"] for t in plan["trips"] if t["kind"] == "outbound"}
        | set(plan["localDirections"])
    )
    manifests = {
        d: client.get(f"/internal/manifest?direction={d}&day={GOLDEN_DAY}", headers=TOKEN).json()[
            "parcels"
        ]
        for d in directions
    }
    couriers = client.get(f"/internal/courier-routes?day={GOLDEN_DAY}", headers=TOKEN).json()
    return {"day": GOLDEN_DAY, "plan": plan, "manifests": manifests, "courierRoutes": couriers}
