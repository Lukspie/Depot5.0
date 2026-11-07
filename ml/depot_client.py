"""Tiny client of the Depot 5.0 API for the host scripts (gate_video.py, dock_scanner.py, labels.py).

Standard library only: session cookie login to the app, JSON and raw image requests. The scripts run
on the host (webcam, video files), not in a container (ADR-013, ADR-059).
"""

import http.cookiejar
import json
import os
import urllib.error
import urllib.request
from typing import Any

APP = os.environ.get("DEPOT_URL", "http://localhost:8000")


class DepotClient:
    def __init__(self, base: str = APP) -> None:
        self.base = base.rstrip("/")
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def _call(self, method: str, path: str, body: bytes | None, content_type: str | None) -> Any:
        headers = {"Origin": self.base}
        if content_type:
            headers["Content-Type"] = content_type
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=30) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"{method} {path}: {exc.code} {exc.read()[:200]!r}") from exc

    def login(self, username: str, password: str) -> None:
        self._call("POST", "/api/auth/login", json.dumps({"username": username, "password": password}).encode(), "application/json")

    def get(self, path: str) -> Any:
        return self._call("GET", path, None, None)

    def post_json(self, path: str, body: Any) -> Any:
        return self._call("POST", path, json.dumps(body).encode(), "application/json")

    def post_image(self, path: str, jpeg: bytes) -> Any:
        return self._call("POST", path, jpeg, "image/jpeg")


def login_from_env(user_var: str, default_user: str) -> DepotClient:
    """DEPOT_USER / DEPOT_PASSWORD (or the given default user and a prompt-free error)."""
    user = os.environ.get(user_var) or os.environ.get("DEPOT_USER") or default_user
    password = os.environ.get("DEPOT_PASSWORD")
    if not password:
        raise SystemExit(f"set DEPOT_PASSWORD (password of {user}, see .env SEED_*_PASSWORD)")
    client = DepotClient()
    client.login(user, password)
    return client
