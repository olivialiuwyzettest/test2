import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { formatMinutesHuman, type ConnectionLayover } from "@/lib/itinerary/layovers";
import { formatMoney } from "@/lib/utils/format";
import { defaultTripConfig, totalPassengers } from "@/lib/config/tripConfig";
import type { Segment } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

function isoTimePart(ts: string): string {
  // "2026-12-10T16:05:00" -> "16:05"
  const t = ts.split("T")[1] ?? "";
  return t.slice(0, 5);
}

function SegmentRow(props: { seg: Segment }) {
  const seg = props.seg;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold text-neutral-900">
          {seg.from} {"->"} {seg.to}
        </div>
        <div className="text-xs text-neutral-500">
          {seg.carrierCode}
          {seg.flightNumber}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-neutral-700">
        <div>
          Dep {seg.departLocal?.slice(0, 10)} {isoTimePart(seg.departLocal ?? "")}
        </div>
        <div>
          Arr {seg.arriveLocal?.slice(0, 10)} {isoTimePart(seg.arriveLocal ?? "")}
        </div>
      </div>
    </div>
  );
}

function LayoverRow(props: { layover: ConnectionLayover }) {
  const l = props.layover;
  const hours = typeof l.minutes === "number" ? (l.minutes / 60).toFixed(1) : "n/a";
  return (
    <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
      Layover at <span className="font-medium">{l.atAirport}</span>: {hours}h{" "}
      {l.isOvernight ? <span className="font-medium text-green-700">(overnight)</span> : null}
    </div>
  );
}

export default async function DealDetail(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const offer = await prisma.offer.findUnique({ where: { id } });
  if (!offer) return notFound();

  const cfg = defaultTripConfig();
  const pax = totalPassengers(cfg.passengers);

  type SegmentsJson = {
    outbound?: Segment[];
    inbound?: Segment[];
    layovers?: { outbound?: ConnectionLayover[]; inbound?: ConnectionLayover[] };
  };
  const seg = offer.segmentsJson as unknown as SegmentsJson;
  const outbound: Segment[] = Array.isArray(seg?.outbound) ? seg.outbound : [];
  const inbound: Segment[] = Array.isArray(seg?.inbound) ? seg.inbound : [];
  const layoversOutbound: ConnectionLayover[] = Array.isArray(seg?.layovers?.outbound) ? seg.layovers!.outbound! : [];
  const layoversInbound: ConnectionLayover[] = Array.isArray(seg?.layovers?.inbound) ? seg.layovers!.inbound! : [];

  const priceHistory = await prisma.priceHistory.findMany({
    where: { offerId: offer.id },
    orderBy: { capturedAt: "desc" },
    take: 14,
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="text-sm text-neutral-700 underline underline-offset-4 hover:text-neutral-900">
            Back
          </Link>
          <Link href="/admin" className="text-sm text-neutral-700 underline underline-offset-4 hover:text-neutral-900">
            Admin
          </Link>
        </div>

        <header className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">
              {offer.origin}
              {"->"}
              {offer.destination} (Business)
            </h1>
              <p className="mt-1 text-sm text-neutral-600">
                Depart {offer.departDate} | Return {offer.returnDate} |{" "}
                {offer.stopsTotal === 0
                  ? "Nonstop"
                  : offer.overnightLayover
                    ? `${offer.stopsTotal} stop${offer.stopsTotal === 1 ? "" : "s"} (overnight)`
                    : `${offer.stopsTotal} stops`}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-neutral-900">{formatMoney(offer.priceTotalCents, offer.currency)}</div>
              <div className="text-xs text-neutral-500">{formatMoney(Math.round(offer.priceTotalCents / pax), offer.currency)} / pax</div>
              <div className="mt-2 text-sm text-neutral-700">
                Deal Score: <span className="font-semibold">{offer.dealScore ?? "-"}</span>
              </div>
            </div>
          </div>

          {Array.isArray(offer.dealRationale) && offer.dealRationale.length > 0 ? (
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-neutral-900">Why it&apos;s a deal</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-neutral-700">
                {offer.dealRationale.map((r: unknown, idx: number) => (
                  <li key={idx}>{String(r)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 text-xs text-neutral-500">
            Total travel time: {offer.totalTripMinutes != null ? formatMinutesHuman(offer.totalTripMinutes) : "n/a"} | Provider:{" "}
            {offer.provider}
          </div>

          {offer.deepLink ? (
            <div className="mt-3">
              <a
                href={offer.deepLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg bg-black px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Open Booking Link
              </a>
            </div>
          ) : null}
        </header>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-neutral-900">Outbound</h2>
            <div className="mt-3 flex flex-col gap-2">
              {outbound.map((s: Segment, idx: number) => (
                <div key={`out-${idx}`} className="flex flex-col gap-2">
                  <SegmentRow seg={s} />
                  {layoversOutbound[idx] ? <LayoverRow layover={layoversOutbound[idx]} /> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-neutral-900">Inbound</h2>
            <div className="mt-3 flex flex-col gap-2">
              {inbound.map((s: Segment, idx: number) => (
                <div key={`in-${idx}`} className="flex flex-col gap-2">
                  <SegmentRow seg={s} />
                  {layoversInbound[idx] ? <LayoverRow layover={layoversInbound[idx]} /> : null}
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-neutral-900">Price history (latest)</h2>
          {priceHistory.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600">No history recorded yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                  <tr>
                    <th className="px-3 py-2">Captured</th>
                    <th className="px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {priceHistory.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 text-xs text-neutral-700">{p.capturedAt.toLocaleString()}</td>
                      <td className="px-3 py-2 font-semibold text-neutral-900">{formatMoney(p.priceTotalCents, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-neutral-500">
            Disclaimer: final pricing and seat availability can change rapidly. Always verify on the airline/OTA checkout page.
          </p>
        </section>
      </div>
    </div>
  );
}
