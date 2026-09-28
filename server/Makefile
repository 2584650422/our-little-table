.PHONY: install dev start check test

install:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt

dev:
	.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port $${PORT:-3000}

start:
	.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $${PORT:-3000}

check:
	.venv/bin/python -m compileall -q app

# 用 unittest 跑服务端回归测试；测试会 mock 数据库和微信/COS，不会改生产数据。
test:
	PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v
