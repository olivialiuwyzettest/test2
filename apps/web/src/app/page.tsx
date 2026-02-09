import Link from "next/link";
import { Filters } from "@/components/Filters";
import { RunScanNowButton } from "@/components/RunScanNowButton";
import { env } from "@/lib/config/env";
import { defaultTripConfig, totalPassengers } from "@/lib/config/tripConfig";
import { prisma } from "@/lib/db/prisma";
import { formatMinutesHuman } from "@/lib/itinerary/layovers";
import type { DashboardFilters } from "@/lib/ui/dashboardData";
import { getDashboardData } from "@/lib/ui/dashboardData";
import { formatMoney } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function getString(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

function getBool(params: SearchParams, key: string): boolean {
  const v = getString(params, key);
  return v === "1" || v === "true";
}

export default async function Home(props: { searchParams?: SearchParams | Promise<SearchParams> }) {
  const params = (await Promise.resolve(props.searchParams ?? {})) as SearchParams;
  const cfg = defaultTripConfig();
  const e = env();

  const filters: DashboardFilters = {
    origin: getString(params, "origin"),
    destination: getString(params, "destination"),
    departFrom: getString(params, "departFrom"),
    departTo: getString(params, "departTo"),
    returnFrom: getString(params, "returnFrom"),
    returnTo: getString(params, "returnTo"),
    nonstopOnly: getBool(params, "nonstopOnly"),
    overnightOnly: getBool(params, "overnightOnly"),
    maxStopsTotal: (() => {
      const s = getString(params, "maxStopsTotal");
      if (!s) return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    })(),
    sort: (() => {
      const s = getString(params, "sort");
      return s === "totalPrice" || s === "duration" || s === "dealScore" ? s : "dealScore";
    })(),
  };

  const data = await getDashboardData(prisma, filters);
  const pax = totalPassengers(cfg.passengers);

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
                Business Class Asia Flight Deal Finder
              </h1>
              <p className="mt-1 text-sm text-neutral-600">
                Scans SEA/YVR to Asia (business class), scores deals, and tracks price history for a family of {pax} (
                {cfg.passengers.adults} adults + {cfg.passengers.children} children).
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Default windows: depart {cfg.departStart} to {cfg.departEnd}; return {cfg.returnStart} to {cfg.returnEnd}.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/admin" className="text-sm text-neutral-700 underline underline-offset-4 hover:text-neutral-900">
                Admin
              </Link>
              <RunScanNowButton />
            </div>
          </header>

          <Filters origins={cfg.origins} destinations={cfg.destinations} />

          <section className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-neutral-700">
                <span className="font-medium">Latest scan:</span>{" "}
                {data.latestScanRun ? (
                  <>
                    {data.latestScanRun.status} at {data.latestScanRun.startedAt.toLocaleString()}
                    {data.latestScanRun.combosSkippedSchedule > 0 ? (
                      <span className="ml-2 text-neutral-500">
                        ({data.latestScanRun.combosSkippedSchedule} combos skipped: schedule not published yet)
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-neutral-500">none yet</span>
                )}
              </div>
              <div className="text-xs text-neutral-500">
                Scheduled scan: {e.SCAN_CRON} ({e.SCAN_TIMEZONE})
              </div>
            </div>

            {data.quotaToday.length > 0 ? (
              <div className="mt-3 text-xs text-neutral-600">
                <span className="font-medium">API quota today:</span>{" "}
                {data.quotaToday.map((q) => `${q.provider}: ${q.requestCount} req (${q.errorCount} err)`).join(" | ")}
              </div>
            ) : null}
          </section>

          {data.topDeals.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">Book Now (Top 3)</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {data.topDeals.map((o) => (
                  <Link
                    key={o.id}
                    href={`/deals/${o.id}`}
                    className="rounded-2xl border border-neutral-200 bg-white p-4 hover:border-neutral-300"
                  >
                    <div className="flex items-baseline justify-between">
                      <div className="text-sm font-semibold text-neutral-900">
                        {o.origin}
                        {"->"}
                        {o.destination}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {o.departDate} / {o.returnDate}
                      </div>
                    </div>
                    <div className="mt-2 flex items-end justify-between">
                      <div>
                        <div className="text-2xl font-semibold text-neutral-900">{o.dealScore ?? "-"}</div>
                        <div className="text-xs text-neutral-500">Deal Score</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold text-neutral-900">
                          {formatMoney(o.priceTotalCents, o.currency)}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {formatMoney(Math.round(o.priceTotalCents / pax), o.currency)} / pax
                        </div>
                      </div>
                    </div>
                    {Array.isArray(o.dealRationale) && o.dealRationale.length > 0 ? (
                      <ul className="mt-3 list-disc pl-5 text-xs text-neutral-700">
                        {o.dealRationale.slice(0, 2).map((r: unknown, idx: number) => (
                          <li key={idx}>{String(r)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Results</h2>
              <div className="text-xs text-neutral-500">{data.offers.length} offers</div>
            </div>

            {data.offers.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-700">
                <p className="font-medium">No offers found yet.</p>
                <p className="mt-1 text-neutral-600">
                  If your travel dates are beyond the airline schedule horizon, this is expected. The app will keep scanning daily.
                </p>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                    <tr>
                      <th className="px-4 py-3">Deal</th>
                      <th className="px-4 py-3">Route</th>
                      <th className="px-4 py-3">Dates</th>
                      <th className="px-4 py-3">Stops</th>
                      <th className="px-4 py-3">Duration</th>
                      <th className="px-4 py-3">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {data.offers.map((o) => (
                      <tr key={o.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <Link href={`/deals/${o.id}`} className="font-semibold text-neutral-900 underline underline-offset-4">
                            {o.dealScore ?? "-"}
                          </Link>
                          {o.isGreatDeal ? <div className="text-xs text-green-700">Great deal</div> : null}
                        </td>
                        <td className="px-4 py-3 font-medium text-neutral-900">
                          {o.origin}
                          {"->"}
                          {o.destination}
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-700">
                          <div>Dep {o.departDate}</div>
                          <div>Ret {o.returnDate}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-700">
                          {o.stopsTotal === 0
                            ? "Nonstop"
                            : o.overnightLayover
                              ? `${o.stopsTotal} stop${o.stopsTotal === 1 ? "" : "s"} (overnight)`
                              : `${o.stopsTotal} stops`}
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-700">
                          {o.totalTripMinutes != null ? formatMinutesHuman(o.totalTripMinutes) : "n/a"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-neutral-900">{formatMoney(o.priceTotalCents, o.currency)}</div>
                          <div className="text-xs text-neutral-500">
                            {formatMoney(Math.round(o.priceTotalCents / pax), o.currency)} / pax
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className="pt-6 text-xs text-neutral-500">
            Prices are estimates from provider APIs and may change at checkout. Do not automate or scrape consumer travel sites.
          </footer>
        </div>
      </div>
    </div>
  );
}
