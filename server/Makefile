.PHONY: install dev start check

install:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt

dev:
	.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port $${PORT:-3000}

start:
	.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $${PORT:-3000}

check:
	.venv/bin/python -m compileall -q app
