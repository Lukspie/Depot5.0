# Build context: repository root (needs both frontend/ and app/).

# ---- stage 1: build the React frontend ----
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- stage 2: Python runtime ----
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# OpenCV (pulled in by RapidOCR, gate OCR, ADR-059) needs these shared libraries
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/*

# install dependencies first (cached layer), using a stub package
COPY app/pyproject.toml ./
RUN mkdir -p src/depotrack && touch src/depotrack/__init__.py \
    && pip install ".[dev]" \
    && rm -rf src

COPY app/src ./src
COPY app/tests ./tests
# shared test cases checked by both backends (ADR-047)
COPY contracts ./contracts
COPY app/alembic.ini ./
COPY app/alembic ./alembic
# trained ML models (phase 6, ADR-057); the app starts without them ("model nedostupný")
COPY ml/artifacts ./ml/artifacts
RUN pip install --no-deps .

COPY --from=frontend /build/dist ./static

RUN useradd --create-home --uid 1000 depotrack && chown -R depotrack /app
USER depotrack

EXPOSE 8000
# migrate db-wms, seed it (idempotent), then serve
CMD ["sh", "-c", "alembic upgrade head && python -m depotrack.seed && exec uvicorn depotrack.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-127.0.0.1}\""]
