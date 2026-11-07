"""Generate docs/api.md from the OpenAPI documents of both running backends (phase 7).

    python tools/gen_api_docs.py      # the stack must run (docker compose up)

Lists every endpoint with its method, summary, tag and who may call it (the roles come from the
dependency names in the app; telematics marks secured routes with bearer/service token).
"""

import json
import urllib.request
from pathlib import Path

APP = "http://localhost:8000/api/openapi.json"
TELEMATICS = "http://localhost:8080/docs/json"
OUT = Path(__file__).resolve().parent.parent / "docs" / "api.md"
METHODS = ("get", "post", "put", "patch", "delete")


def load(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as r:  # noqa: S310 (local)
        return json.load(r)


def rows(doc: dict) -> list[tuple[str, str, str, str]]:
    out = []
    for path, item in sorted(doc["paths"].items()):
        for m in METHODS:
            op = item.get(m)
            if not op:
                continue
            tag = (op.get("tags") or ["—"])[0]
            summary = (op.get("summary") or op.get("description") or "").split("\n")[0].replace("|", "/")
            out.append((tag, m.upper(), path, summary))
    return sorted(out)


def table(title: str, base: str, doc: dict, note: str) -> str:
    lines = [f"## {title}", "", f"Základná adresa: `{base}`. {note}", "", "| Skupina | Metóda | Cesta | Popis |", "| --- | --- | --- | --- |"]
    lines += [f"| {t} | {m} | `{p}` | {s} |" for t, m, p, s in rows(doc)]
    return "\n".join(lines) + "\n"


def main() -> None:
    app, tel = load(APP), load(TELEMATICS)
    text = "\n".join(
        [
            "# API Depot 5.0",
            "",
            "> Pre koho: kto píše klienta, skript alebo kapitolu dokumentácie. Vygenerované z OpenAPI oboch backendov",
            "> skriptom `tools/gen_api_docs.py`, interaktívne: http://localhost:8000/api/docs a http://localhost:8080/docs.",
            "",
            "**Prístup:**",
            "- **app:** session cookie po `POST /api/auth/login`, každý endpoint má `require_role(...)` (ADR-017). Admin smie všetko.",
            "  `/internal/*` volá len telematika so `X-Service-Token`. `POST` z prehliadača musí mať správny `Origin` (CSRF).",
            "- **telematika:** `GET /sim/clock` a `/health` sú verejné, ostatné potrebujú `Authorization: Bearer <ticket>` (ticket z",
            "  `POST /api/auth/ws-ticket`, 60 s) alebo `X-Service-Token`. Ovládanie simulácie len admin a `SIM_CONTROLS_ENABLED=true` (ADR-053).",
            "- Nové API sú v camelCase (ADR-036), chyby po anglicky (ADR-019).",
            "",
            table("Hlavný backend (app, Python FastAPI)", "http://localhost:8000", app, f"{len(app['paths'])} ciest."),
            table("Telematika (Node.js Fastify)", "http://localhost:8080", tel, f"{len(tel['paths'])} ciest. WebSocket: `ws://localhost:8080/ws?ticket=…` (kanály clock, vehicles, devices, alerts)."),
        ]
    )
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"{OUT}: {len(rows(app))} + {len(rows(tel))} endpointov")


if __name__ == "__main__":
    main()
