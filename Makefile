.PHONY: install test lint run migrate demo ingest-crime frontend-install frontend-test frontend-build test-all docker-build

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

ingest-crime:
	@if [ -z "$$MCA_ADMIN_INGEST_TOKEN" ]; then \
		echo "MCA_ADMIN_INGEST_TOKEN is required"; \
		exit 1; \
	fi
	curl --fail --show-error -s -X POST -H "X-Admin-Token: $$MCA_ADMIN_INGEST_TOKEN" \
		"http://127.0.0.1:8000/admin/crime/ingest/socrata?limit=5000&offset=0"

frontend-install:
	cd frontend && npm install

frontend-test:
	cd frontend && npm test

frontend-build:
	cd frontend && npm run build

test-all: test lint frontend-test frontend-build

docker-build:
	docker build .
