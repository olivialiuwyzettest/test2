# wbr-deck-agent

Local-first internal app that ingests 50+ Tableau dashboard screenshots and/or PDFs for a weekly business review (WBR), extracts **grounded** observations, and renders a minimalist single-page HTML deck.

## Safety / Safe-Ops

- Do **not** run destructive commands (no `rm -rf` outside this repo, no force push).
- Ask before deleting files.

## Architecture (MVP)

- Backend: Python + FastAPI (in-process job queue)
- Storage: local filesystem + SQLite (run metadata)
- PDF -> image: PyMuPDF (each page becomes an image so the same vision pipeline applies)
- Output: `out/deck.html` + `out/extraction.jsonl` + `out/insights.json`
- Frontend: Vite + React (dev server). If Node isn’t installed, `./scripts/ensure_node.sh` downloads a local Node runtime under `.dev/`.

## Setup

```bash
cd wbr-deck-agent
make install
make frontend-install
```

## Run (Dev)

```bash
make dev
```

- UI: http://127.0.0.1:5173
- API: http://127.0.0.1:8000

If you see "Address already in use", something else is already running on `8000` or `5173`. Stop it (or change ports via `BACKEND_PORT` / `FRONTEND_PORT`) and retry.

Example (alternate ports):

```bash
BACKEND_PORT=8001 FRONTEND_PORT=5174 make dev
```

## Run (Backend Only)

```bash
make backend
```

Note: the frontend dev server is bound to `127.0.0.1` for reliability on macOS (some setups bind `localhost` to IPv6 only).

## AI Configuration (Optional)

Mock mode is used automatically when no API key is configured.

Environment variables:

- `WBR_PROVIDER=auto|openai|anthropic` (default: `auto`)
- `WBR_MOCK_MODE=true|false` (optional override)

OpenAI (vision extraction):

- `OPENAI_API_KEY`
- `WBR_OPENAI_MODEL` (optional)

Anthropic / Claude (vision extraction):

- `ANTHROPIC_API_KEY`
- `WBR_ANTHROPIC_MODEL` (optional; default in code)

Note: when using Anthropic, oversized screenshots are automatically downscaled/re-encoded to stay within the API’s image size limits.

## CLI (Deck Build)

Generate a deck from a folder containing images and PDFs:

```bash
cd wbr-deck-agent
.venv/bin/python -m wbr_deck_agent.cli build --input data/uploads/... --week 2026-W06
```

Mock mode:

```bash
.venv/bin/python -m wbr_deck_agent.cli build --input sample_inputs --week 2026-W06 --mock
```

Artifacts:

- `out/extraction.jsonl` (per-asset strict JSON extractions)
- `out/insights.json` (deck source-of-truth)
- `out/deck.html` (single-page WBR deck)

## Tests

```bash
cd wbr-deck-agent
make test
```
