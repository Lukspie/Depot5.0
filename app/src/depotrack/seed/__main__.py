"""CLI: python -m depotrack.seed"""

import logging

from depotrack.core.config import get_settings
from depotrack.core.db import get_session_factory
from depotrack.seed import run_seed


def main() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(), format="%(levelname)s %(name)s: %(message)s"
    )
    with get_session_factory()() as db:
        run_seed(db, settings)


if __name__ == "__main__":
    main()
