.PHONY: install test lint run migrate demo seed-crime ingest-crime seed-arrests ingest-arrests seed-calls ingest-calls fetch-tiles frontend-install frontend-test frontend-build test-all docker-build soak-load soak-observe

install:
	python3.11 -m venv .venv
	.venv/bin/python -m pip install -e '.[dev]'

test:
	.venv/bin/python -m pytest tests -q

lint:
	.venv/bin/ruff check .

run:
	.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

migrate:
	.venv/bin/alembic upgrade head

demo:
	curl -s http://127.0.0.1:8000/health

seed-crime:
	.venv/bin/python scripts/seed_crime.py

ingest-crime:
	@if [ -z "$$MCA_ADMIN_INGEST_TOKEN" ]; then \
		echo "MCA_ADMIN_INGEST_TOKEN is required"; \
		exit 1; \
	fi
	curl --fail --show-error -s -X POST -H "X-Admin-Token: $$MCA_ADMIN_INGEST_TOKEN" \
		"http://127.0.0.1:8000/admin/crime/ingest/socrata?limit=5000&offset=0"

seed-arrests:
	.venv/bin/python scripts/seed_arrests.py

ingest-arrests:
	@if [ -z "$$MCA_ADMIN_INGEST_TOKEN" ]; then \
		echo "MCA_ADMIN_INGEST_TOKEN is required"; \
		exit 1; \
	fi
	curl --fail --show-error -s -X POST -H "X-Admin-Token: $$MCA_ADMIN_INGEST_TOKEN" \
		"http://127.0.0.1:8000/admin/crime/ingest/socrata?source=seattle_spd_arrests&mode=backfill&limit=5000"

seed-calls:
	.venv/bin/python scripts/seed_calls.py

ingest-calls:
	@if [ -z "$$MCA_ADMIN_INGEST_TOKEN" ]; then \
		echo "MCA_ADMIN_INGEST_TOKEN is required"; \
		exit 1; \
	fi
	curl --fail --show-error -s -X POST -H "X-Admin-Token: $$MCA_ADMIN_INGEST_TOKEN" \
		"http://127.0.0.1:8000/admin/crime/ingest/socrata?source=seattle_spd_911&mode=backfill&limit=5000"

fetch-tiles:
	.venv/bin/python scripts/fetch_tiles.py

frontend-install:
	cd frontend && npm install

frontend-test:
	cd frontend && npm test

frontend-build:
	cd frontend && npm run build

test-all: test lint frontend-test frontend-build

docker-build:
	docker build .

# Postgres soak test (H2) — see docs/soak-testing.md. Run both from the repo root.
soak-load:
	.venv/bin/python scripts/soak/soak_driver.py --users $${USERS:-25} --duration $${DURATION:-2h} --out $${OUT:-soak-out}

soak-observe:
	.venv/bin/python scripts/soak/pg_observer.py --interval $${INTERVAL:-15} --duration $${DURATION:-2h} --out $${OUT:-soak-out}
