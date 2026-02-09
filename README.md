# Business Class Asia Flight Deal Finder

Next.js app that scans business-class roundtrip flight offers from **SEA (Seattle)** or **YVR (Vancouver)** to **Asia**, stores results + price history, computes a **Deal Score (0-100)**, and recommends "Book Now" opportunities for a family trip.

Hard defaults match the prompt:

- Passengers: **4 adults + 2 children** (configurable)
- Cabin: **Business**
- Depart window: **2026-12-10 .. 2026-12-20**
- Return window: **2027-01-01 .. 2027-01-07**
- Preferences:
  - Prefer nonstop
  - If not nonstop: allow connections only when there is **exactly one overnight layover**
    - Overnight = layover **>= 8 hours** AND crosses local midnight (arrival date != next departure date)

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- SQLite (dev) via Prisma ORM
- Background scanning: `node-cron` worker (`npm run worker`)
- Providers:
  - `MockProvider` (deterministic sample data; no keys needed)
  - `AmadeusProvider` (Amadeus Self-Service Flight Offers Search; requires API keys)

## Repo Layout

- `apps/web`: Next.js app, Prisma schema, providers, scanner, scoring, UI
- `docker-compose.yml`: starts `web` + `worker`

## Quickstart (Local, No Docker)

Prereqs: Node 20+ and npm.

```bash
cd "apps/web"
cp .env.example .env
npm install

# Prisma needs the sqlite file to exist
touch prisma/dev.db
npm run db:migrate

npm run dev
```

Open `http://localhost:3000`.

You should immediately see results because the Prisma seed runs a scan via `MockProvider` (and is safe to re-run).

## Run Scans

- From the UI: click **Run Scan Now**
- From CLI:

```bash
cd "apps/web"
touch prisma/dev.db
npm run scan
```

## Daily Scheduler (Local/Dev)

Run the background worker (cron default is **06:00 America/Los_Angeles**):

```bash
cd "apps/web"
touch prisma/dev.db
npm run worker
```

To run a scan on startup:

```bash
RUN_SCAN_ON_STARTUP="true" npm run worker
```

To move scanning to hosted cron (GitHub Actions / Vercel Cron / etc.), call `POST /api/scan`.

## Deal Scoring

Comparable set for an offer:

- same origin, destination, cabin, and stops category (nonstop vs overnight-connection)
- depart/return dates within **±2 days**

Signals:

- Price percentile vs comparable offers
- Spread vs comparable median
- Price drop within last 7 days (from `PriceHistory`)
- Quality: nonstop bonus, overnight-layover bonus, duration penalty vs comparable median

"Great deal" triggers (any):

- Deal Score >= 80
- price <= 15th percentile in comparable set
- price dropped >= 10% in last 7 days

The UI shows the exact rationale bullets used.

## Providers

### MockProvider (default)

No keys needed. Deterministic sample data so the UI works immediately and tests can pass.

### Amadeus Self-Service API

Set these in `apps/web/.env`:

```env
FLIGHT_PROVIDER="amadeus"
AMADEUS_HOST="https://test.api.amadeus.com"
AMADEUS_CLIENT_ID="..."
AMADEUS_CLIENT_SECRET="..."
```

Notes:

- Flight schedules may not be published yet for some future dates. The scanner will skip combinations that are beyond the provider's typical schedule horizon and record "schedule not published" stats on the latest scan run.
- No scraping: only official provider APIs.

## Destinations (Asia Airports)

The app loads `apps/web/src/data/airports_asia.json` and falls back to a curated hub list if needed.

To restrict scanning:

- `DESTINATIONS_INCLUDE="HND,ICN,SIN"`
- `DESTINATIONS_LIMIT="25"`

## Tests

```bash
cd "apps/web"
npm test
```

Includes unit tests for:

- date-pair generator
- overnight layover detection
- deal scoring

And an integration test that runs a scan with `MockProvider`, writes to SQLite, and queries dashboard data.

## Docker

One-command local run:

```bash
docker compose up --build
```

- `web` is on `http://localhost:3000`
- `worker` runs the daily scan schedule and also scans on startup by default

Set `FLIGHT_PROVIDER="amadeus"` and Amadeus env vars in your compose environment if you want live API results.

## Deploy (Render)

This repo includes a Render Blueprint config at `render.yaml`.

**Important:** This app uses SQLite, so the Render deployment uses a persistent disk to keep the database between restarts.
That requires a paid Render plan (the free tier can spin down and does not support disks).

### 1) Put This Repo on GitHub (one-time)

From the repo root:

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new GitHub repository (empty) in your browser, then run the commands GitHub shows you to add `origin` and push.

### 2) Create the Render App

Open this in your browser (replace with your GitHub repo URL):

`https://dashboard.render.com/blueprint/new?repo=https://github.com/YOUR_ORG/YOUR_REPO`

Then click **Apply**.

### 3) (Optional) Enable Live Prices (Amadeus)

In Render Dashboard, set:

- `FLIGHT_PROVIDER=amadeus`
- `AMADEUS_CLIENT_ID` (secret)
- `AMADEUS_CLIENT_SECRET` (secret)

If flight schedules for Dec 2026 are not published yet, the scan will show no results and keep trying daily.
