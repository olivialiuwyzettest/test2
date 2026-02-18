# Wyze RTO Attendance (MVP)

Internal web app for Wyze managers and leadership to track daily office attendance and weekly RTO compliance using Brivo badge data.

## What This MVP Includes

- Simple gated login (`email + shared access code`) with `@wyze.com` domain allowlist.
- RBAC from DB (`AppUser` table): `ADMIN`, `LEADER`, `MANAGER`.
- Dashboards:
  - `/leader`: org compliance, team-level drilldown, trailing trends.
  - `/manager`: direct-report compliance with deficits and last seen.
  - `/teams/[teamId]`: week heatmap (employees x weekdays).
  - `/employees/[employeeId]`: trend + daily markers (+ raw events for admins only).
  - `/admin`: schedules, doors, roster import, holidays import, Brivo mappings, sync controls.
- Brivo adapter layer with `mock` and `live` modes.
- Polling sync + webhook receiver + daily reconciliation endpoint.
- CSV export for compliance summaries.

## Tech Stack

- Next.js App Router + TypeScript
- Tailwind + lightweight shadcn-style UI components
- PostgreSQL + Prisma + SQL migrations
- Recharts for trends

## Local Setup

1. Copy env template:

```bash
cp .env.example .env
```

2. Set required values in `.env`:

- `DATABASE_URL`
- `APP_SHARED_ACCESS_CODE`
- `APP_SESSION_SECRET`

3. Install dependencies:

```bash
pnpm install
```

4. Run migrations + seed sample data:

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:seed
```

5. Start app:

```bash
pnpm dev
```

Open: http://localhost:3000

## Seeded Demo Accounts

Use any seeded account + `APP_SHARED_ACCESS_CODE` to sign in:

- `admin@wyze.com` (ADMIN)
- `leader@wyze.com` (LEADER)
- `manager.product@wyze.com` (MANAGER)
- `manager.eng@wyze.com` (MANAGER)
- `manager.cx@wyze.com` (MANAGER)

## Data Model

Core Prisma models:

- `AppUser`: app allowlist + role mapping
- `Employee`: roster identity + team + manager + optional `brivoUserId`
- `Team`: schedule days + required days policy
- `OfficeLocation`: location + timezone + optional Brivo site ID
- `Door`: location door config + `countsForEntry`
- `Holiday`: configurable holiday calendar (global or location-specific)
- `BrivoEventRaw`: idempotent raw event storage (`brivoEventId` unique)
- `AttendanceDay`: derived per-employee daily presence records
- `IngestionCursor`: polling watermark
- `AppSetting`: persistent app settings (e.g., webhook subscription metadata)

Migration SQL is committed in `/prisma/migrations/20260218120000_init/migration.sql`.

## Compliance Logic

A day is counted present when:

1. Event is linked to a known door with `countsForEntry=true`
2. Event marker indicates successful entry (`eventType` or `securityAction` in configured marker list)
3. Brivo user is mapped to an employee (`Employee.brivoUserId`)

Weekly calculations:

- Eligible workdays = Mon-Fri minus configured holidays (global + location-specific)
- `baseRequired` = `Team.requiredDaysPerWeek` (default 3)
- `requiredDaysAdjusted` = `min(baseRequired, eligibleWorkdaysCount)`
- `actualDays` = count of present eligible days
- `policyCompliant` = `actualDays >= requiredDaysAdjusted`
- `scheduleAdherencePct` = `attendedOnScheduledDays / scheduledEligibleDays`

### Example

Team schedule: `MON,WED,THU`, required `3`

- If week has 5 eligible days: `requiredDaysAdjusted = 3`
- If one holiday removes Thu and eligible days become 4: still `3`
- If multiple holidays drop eligible days to 2: `requiredDaysAdjusted = 2`

## Imports (Admin)

### Roster CSV

Expected headers (case-insensitive):

- `email`, `name`, `team`
- Optional: `managerEmail`, `status`, `brivoUserId`, `officeLocation`, `timezone`, `scheduleDays`, `requiredDaysPerWeek`

### Holidays CSV or JSON

CSV:

```csv
date,name,officeLocation
2026-11-26,Thanksgiving,Seattle HQ
2026-11-27,Day After Thanksgiving,Seattle HQ
```

JSON:

```json
[
  { "date": "2026-11-26", "name": "Thanksgiving", "officeLocation": "Seattle HQ" }
]
```

Note: the app does **not** assume US federal holidays; holidays are fully admin-configurable.

### Brivo Mapping CSV

```csv
employeeEmail,brivoUserId
alice.pm@wyze.com,12345
```

## Brivo Integration

### Modes

- `BRIVO_MODE=mock` (default): deterministic generated events for local/dev use.
- `BRIVO_MODE=live`: uses real OAuth + Brivo API requests.

### Live Mode Env Vars

Set:

- `BRIVO_API_KEY`
- `BRIVO_CLIENT_ID`
- `BRIVO_CLIENT_SECRET`
- Optional: `BRIVO_REFRESH_TOKEN` for refresh-token grant
- Optional: `BRIVO_USERNAME` and `BRIVO_PASSWORD` for password grant

Adapter supports endpoints:

- `/users`
- `/sites`
- `/events`
- `/event-subscriptions`

`Authorization: Bearer <token>` and configurable API key header are both sent.

### Polling Sync

- Admin button: “Sync Now” (yesterday -> now)
- API cron endpoint: `GET /api/cron/sync` (optionally protected by `APP_CRON_SECRET`)

### Webhook Mode

- Receiver endpoint: `POST /api/brivo/webhook`
- Admin action creates/refreshes `/event-subscriptions`
- Supports reconciliation alongside polling

## Export

- Compliance CSV export endpoint:
  - `/api/export/compliance?week=YYYY-MM-DD&teamId=...&locationId=...`

## Notes / TODO for Real Brivo Tenant

- Confirm exact `/events` query parameter names/shape for your account.
- Confirm exact `/event-subscriptions` payload contract.
- Validate token grant type requirements for your tenant (`password` vs `client_credentials`).
- Optionally add request signature verification details from Brivo webhook docs.
