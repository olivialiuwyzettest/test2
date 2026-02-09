import Link from "next/link";
import { DateTime } from "luxon";
import { RunScanNowButton } from "@/components/RunScanNowButton";
import { env } from "@/lib/config/env";
import { defaultTripConfig } from "@/lib/config/tripConfig";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

function scanDayInTz(): string {
  const e = env();
  return DateTime.now().setZone(e.SCAN_TIMEZONE).toISODate()!;
}

export default async function Admin() {
  const e = env();
  const cfg = defaultTripConfig();
  const today = scanDayInTz();
  const since7 = DateTime.now().setZone(e.SCAN_TIMEZONE).minus({ days: 6 }).toISODate()!;

  let runs: Awaited<ReturnType<typeof prisma.scanRun.findMany>> = [];
  let quota7d: Awaited<ReturnType<typeof prisma.providerQuotaDay.findMany>> = [];
  let offers = 0;
  try {
    [runs, quota7d, offers] = await Promise.all([
      prisma.scanRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
      prisma.providerQuotaDay.findMany({
        where: { day: { gte: since7, lte: today } },
        orderBy: [{ day: "desc" }, { provider: "asc" }],
      }),
      prisma.offer.count(),
    ]);
  } catch {
    // DB not initialized yet (migrations not applied). Keep the page usable.
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Admin</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Provider: <span className="font-medium">{e.FLIGHT_PROVIDER}</span> | Offers in DB:{" "}
              <span className="font-medium">{offers}</span>
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Defaults: origins {cfg.origins.join(", ")} | depart {cfg.departStart}..{cfg.departEnd} | return {cfg.returnStart}
              ..{cfg.returnEnd} | pax {cfg.passengers.adults}A+{cfg.passengers.children}C
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-neutral-700 underline underline-offset-4 hover:text-neutral-900">
              Dashboard
            </Link>
            <RunScanNowButton />
          </div>
        </header>

        <section className="rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-neutral-900">API quota (last 7 days)</h2>
          {quota7d.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600">No quota data yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                  <tr>
                    <th className="px-3 py-2">Day</th>
                    <th className="px-3 py-2">Provider</th>
                    <th className="px-3 py-2">Requests</th>
                    <th className="px-3 py-2">Errors</th>
                    <th className="px-3 py-2">Last error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {quota7d.map((q) => (
                    <tr key={q.id}>
                      <td className="px-3 py-2 text-xs text-neutral-700">{q.day}</td>
                      <td className="px-3 py-2 font-medium text-neutral-900">{q.provider}</td>
                      <td className="px-3 py-2 text-neutral-900">{q.requestCount}</td>
                      <td className="px-3 py-2 text-neutral-900">{q.errorCount}</td>
                      <td className="px-3 py-2 text-xs text-neutral-600">{q.lastError ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-neutral-900">Scan runs</h2>
          {runs.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600">No scan runs yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                  <tr>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Provider</th>
                    <th className="px-3 py-2">Combos</th>
                    <th className="px-3 py-2">Skipped</th>
                    <th className="px-3 py-2">Offers</th>
                    <th className="px-3 py-2">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-xs text-neutral-700">{r.startedAt.toLocaleString()}</td>
                      <td className="px-3 py-2 font-medium text-neutral-900">{r.status}</td>
                      <td className="px-3 py-2 text-neutral-700">{r.provider}</td>
                      <td className="px-3 py-2 text-neutral-700">{r.combosTotal}</td>
                      <td className="px-3 py-2 text-neutral-700">{r.combosSkippedSchedule}</td>
                      <td className="px-3 py-2 text-neutral-700">{r.offersFound}</td>
                      <td className="px-3 py-2 text-xs text-neutral-600">
                        {Array.isArray(r.errorsJson) ? `${r.errorsJson.length} errors` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
