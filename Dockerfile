FROM node:22-slim AS frontend

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# ca-certificates so outbound HTTPS (e.g. the Socrata ingest via urllib) can verify TLS;
# the python:slim base ships without it, which otherwise fails CERTIFICATE_VERIFY_FAILED.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir .

COPY alembic ./alembic
COPY alembic.ini ./alembic.ini
COPY --from=frontend /app/static/dashboard ./app/static/dashboard

# Drop root: the runtime needs no privileges. Own /app so a SQLite-fallback boot (no
# MCA_DATABASE_URL) can still create its dev-output dir; the deploy path uses Postgres.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
