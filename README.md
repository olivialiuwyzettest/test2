# Wyze Pulse

Daily sentiment + competitive landscape dashboard for Wyze vs competitors.

- Single page dashboard: `/`
- Methodology: `/methodology`
- TV mode: `/tv`
- Static data files under `public/data/` (committed + refreshed by GitHub Actions)
- Pluggable connectors (`sample` required; `rss` + `reddit` optional/opt-in)

## Local Development

```bash
pnpm i
pnpm dev
```

Open: http://localhost:3000

## Data Refresh

### Sample Data (no keys required)

```bash
pnpm refresh-data:sample
```

This uses `data/sample_mentions.json` only, with deterministic enrichment (no network).

### Real Refresh (OpenAI + optional connectors)

Set `OPENAI_API_KEY`, then:

```bash
pnpm refresh-data
```

Notes:

- `DATA_CONNECTORS` defaults to `sample`.
- If you enable `rss` or `reddit`, `OPENAI_API_KEY` is required.
- RSS/Reddit connectors are opt-in and use official/public APIs (no brittle scraping by default).
- Coverage note: if you restrict ingestion to only one brand community (e.g., only Wyze),
  competitor comparisons will be biased. Include competitor sources too.

## Deployment (Vercel)

1. Import the repo in Vercel
2. Set environment variables (optional for sample-only mode):
   - `TIMEZONE` (default is `America/Los_Angeles`)
   - `OPENAI_API_KEY` (required if you enable non-sample connectors)
   - `DATA_CONNECTORS`, `RSS_FEEDS`, and Reddit credentials as needed
3. Deploy

The site updates when `public/data/*.json` changes on `main` (or your default branch).

## Deployment (Render)

This repo includes a Render Blueprint at `render.yaml`.

1. Push the repo to GitHub/GitLab/Bitbucket (Render Blueprints are Git-backed)
2. In Render Dashboard: New +, select "Blueprint"
3. Point it at your repo and apply
4. Set any secrets marked `sync: false` (only needed if you enable `rss`/`reddit`)

Note: `render.yaml` defaults to deploying the `main` branch. If you deploy a different branch, update `branch:` in `render.yaml` (or rename your default branch to `main`).

## Daily Refresh (No Server Required)

This repo includes a scheduled GitHub Actions workflow: `.github/workflows/daily-refresh.yml`.

- It runs daily on a cron schedule and on manual dispatch.
- It runs `pnpm refresh-data`, then commits and pushes changes **only if** `public/data/*.json` changed.
- The cron schedule is defined in **UTC** (GitHub Actions uses UTC for cron).

This pattern works well with Vercel/Netlify because a commit triggers a redeploy.

## Data + Privacy Notes

- This dashboard is designed to ingest **public** text and source URLs only.
- Do not store emails, phone numbers, or other private identifiers.
- External connectors are disabled by default and should be configured to follow source ToS.
