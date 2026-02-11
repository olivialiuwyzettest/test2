SHELL := /bin/bash

.PHONY: venv install backend frontend-install frontend dev run test sample

venv:
	python3 -m venv .venv
	.venv/bin/python -m pip install --upgrade pip

install: venv
	.venv/bin/pip install -e ".[dev]"

backend:
	.venv/bin/uvicorn wbr_deck_agent.api.main:app --reload --port 8000

frontend-install:
	./scripts/npm.sh --prefix frontend install

frontend:
	./scripts/npm.sh --prefix frontend run dev -- --port 5173 --host 127.0.0.1 --strictPort

dev:
	./scripts/dev.sh

run:
	.venv/bin/uvicorn wbr_deck_agent.api.main:app --port 8000

test:
	.venv/bin/pytest -q

sample:
	.venv/bin/python scripts/generate_sample_inputs.py
	.venv/bin/python -m wbr_deck_agent.cli build --input sample_inputs --week 2026-W06 --mock
