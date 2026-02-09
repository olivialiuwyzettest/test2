# Wyze Intel Hub

External intelligence wallboard for Wyze:

- Latest mentions related to Wyze (news + public discussions)
- High-engagement consumer sentiment from public forums (30-day scan)
- Main competitors (Ring, Blink, Eufy, TP-Link, Reolink, Arlo)
- Emerging competitors (AI monitoring + smart security players)

Live site: https://wyze-intel-hub.onrender.com/

## Stack

- FastAPI + Jinja templates
- SQLite (local file)
- APScheduler (daily refresh job)

## Pages

- `/`: Main Intel Hub (scrollable)
- `/tv`: 10-foot wallboard (kiosk-safe, no scrolling, auto-rotating pages)
- `/dashboards/wyze`
- `/dashboards/sentiment`
- `/dashboards/competitors`
- `/dashboards/emerging`

## TV Mode

Open:

- `/tv`

Controls (query params):

- `rotate`: page rotation interval seconds (default from `TV_ROTATION_SECONDS`)
- `ticker`: ticker rotation seconds (default from `TV_TICKER_SECONDS`)
- `scale`: manual scale override (example: `/tv?scale=0.9`)

## Theme Tokens

Primary brand color is `#7951D6`.

- Light (default) tokens: `app/static/theme.css`
- TV (dark) overrides: `app/static/tv.css` scoped to `body.mode-tv`

## Local Development

```bash
cd "<repo-root>"
.runtime/python/bin/pip3 install -r requirements.txt

# Optional: skip refresh on startup for faster boot
RUN_REFRESH_ON_STARTUP=false .runtime/python/bin/python3 -m uvicorn app.main:app --reload
```

Then open:

- http://127.0.0.1:8000/
- http://127.0.0.1:8000/tv

## Refresh / Ingestion

Manual refresh:

```bash
cd "<repo-root>"
.runtime/python/bin/python3 scripts/refresh_intel.py
```

Admin endpoint (if `ADMIN_TOKEN` is set):

- `POST /admin/refresh`

## Render Deployment (API)

This repo includes `scripts/deploy_render.py`, which deploys via Render's API by shipping only `app/` + `requirements.txt`.

```bash
export RENDER_API_KEY="rnd_..."
.runtime/python/bin/python3 scripts/deploy_render.py
```

Notes:

- Free Render services can spin down when idle; the first load after idle can take ~30-60s.
- Image pulls from Docker Hub can intermittently fail; the deploy script defaults to an MCR-hosted Python image for reliability.
