"""Serving the built React frontend (single-page application) from FastAPI."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Serve hashed assets directly and fall back to index.html for client-side routes.

    Paths under /api and /internal are never answered with index.html, so unknown API calls
    stay 404.
    """
    index = static_dir / "index.html"
    if not index.is_file():
        return

    assets = static_dir / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    root = static_dir.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        if full_path.split("/", 1)[0] in ("api", "internal"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (root / full_path).resolve()
        if full_path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        if full_path.startswith("track/"):
            # the tracking token is in the URL: never send it on as a Referer, never cache it
            return FileResponse(
                index, headers={"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"}
            )
        return FileResponse(index)
