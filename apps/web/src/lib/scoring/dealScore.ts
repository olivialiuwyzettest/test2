import type { PrismaClient, StopsCategory } from "@prisma/client";
import { DateTime } from "luxon";
import { formatMinutesHuman } from "@/lib/itinerary/layovers";
import { addDays } from "@/lib/utils/date";
import { formatMoney } from "@/lib/utils/format";
import { median, percentileRank } from "@/lib/scoring/stats";

export type DealMetrics = {
  dealScore: number;
  isGreatDeal: boolean;
  rationale: string[];
  pricePercentile: number | null;
  comparableMedianPriceCents: number | null;
  priceDrop7dPct: number | null;
  durationVsMedianMinutes: number | null;
};

export function computeDealMetrics(input: {
  offer: {
    origin: string;
    destination: string;
    cabin: string;
    stopsCategory: StopsCategory;
    stopsTotal: number;
    priceTotalCents: number;
    currency: string;
    totalTripMinutes: number | null;
  };
  comparable: Array<{ priceTotalCents: number; totalTripMinutes: number | null }>;
  priceHistory7d: Array<{ priceTotalCents: number; capturedAt: Date }>;
}): DealMetrics {
  const comparablePrices = input.comparable.map((o) => o.priceTotalCents).filter((n) => Number.isFinite(n));
  const pricePercentile = percentileRank(comparablePrices, input.offer.priceTotalCents);
  const comparableMedianPriceCents = median(comparablePrices);

  const comparableDurations = input.comparable
    .map((o) => o.totalTripMinutes)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const medianDuration = median(comparableDurations);
  const durationVsMedianMinutes =
    input.offer.totalTripMinutes != null && medianDuration != null ? Math.round(input.offer.totalTripMinutes - medianDuration) : null;

  const history = input.priceHistory7d.slice().sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  let priceDrop7dPct: number | null = null;
  if (history.length >= 2) {
    const old = history[0]!.priceTotalCents;
    const current = history[history.length - 1]!.priceTotalCents;
    if (old > 0 && current < old) priceDrop7dPct = (old - current) / old;
    else priceDrop7dPct = 0;
  }

  const rationale: string[] = [];
  if (pricePercentile != null && comparablePrices.length >= 4) {
    rationale.push(
      `${formatMoney(input.offer.priceTotalCents, input.offer.currency)} total is in the ${Math.round(pricePercentile)}th percentile vs comparable ${input.offer.origin}->${input.offer.destination} business itineraries.`,
    );
  }
  if (comparableMedianPriceCents != null && comparableMedianPriceCents > 0 && comparablePrices.length >= 4) {
    const delta = comparableMedianPriceCents - input.offer.priceTotalCents;
    const abs = Math.abs(delta);
    if (abs >= 25_000) {
      rationale.push(
        `${delta >= 0 ? "Cheaper" : "More expensive"} than the comparable median by ${formatMoney(abs, input.offer.currency)}.`,
      );
    }
  }
  if (input.offer.stopsTotal === 0) {
    rationale.push("Nonstop on both legs.");
  } else if (input.offer.stopsCategory === "ONE_STOP_OVERNIGHT") {
    rationale.push(
      input.offer.stopsTotal === 1
        ? "Exactly one stop with an overnight sleep layover."
        : `${input.offer.stopsTotal} stops with exactly one overnight sleep layover.`,
    );
  }
  if (priceDrop7dPct != null && priceDrop7dPct >= 0.1) {
    rationale.push(`Price dropped ${Math.round(priceDrop7dPct * 100)}% vs earliest price seen in the last 7 days.`);
  }
  if (input.offer.totalTripMinutes != null && medianDuration != null) {
    rationale.push(
      `Total travel time ${formatMinutesHuman(input.offer.totalTripMinutes)} vs median ${formatMinutesHuman(Math.round(medianDuration))}.`,
    );
  }

  // Score (0-100). Lower percentile and shorter duration increase score.
  let score = 50;
  if (pricePercentile != null) {
    if (pricePercentile <= 15) score += 30;
    else if (pricePercentile <= 30) score += 20;
    else if (pricePercentile <= 50) score += 10;
    else if (pricePercentile >= 85) score -= 15;
    else if (pricePercentile >= 70) score -= 8;
  }
  if (priceDrop7dPct != null) {
    if (priceDrop7dPct >= 0.15) score += 12;
    else if (priceDrop7dPct >= 0.1) score += 10;
    else if (priceDrop7dPct >= 0.05) score += 6;
  }
  if (input.offer.stopsTotal === 0) score += 10;
  else if (input.offer.stopsCategory === "ONE_STOP_OVERNIGHT") score += 5;
  if (durationVsMedianMinutes != null && durationVsMedianMinutes > 0) {
    // Up to -15 for very long itineraries vs comparable median.
    score -= Math.min(15, Math.round(durationVsMedianMinutes / 60) * 2);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const isGreatDeal =
    score >= 80 || (pricePercentile != null && pricePercentile <= 15) || (priceDrop7dPct != null && priceDrop7dPct >= 0.1);

  return {
    dealScore: score,
    isGreatDeal,
    rationale,
    pricePercentile,
    comparableMedianPriceCents: comparableMedianPriceCents == null ? null : Math.round(comparableMedianPriceCents),
    priceDrop7dPct,
    durationVsMedianMinutes,
  };
}

function nearbyDates(date: string, radiusDays = 2): string[] {
  const out: string[] = [];
  for (let d = -radiusDays; d <= radiusDays; d += 1) out.push(addDays(date, d));
  return out;
}

export async function recomputeDealScoresForScanRun(prisma: PrismaClient, scanRunId: string) {
  const offerIds = await prisma.priceHistory
    .findMany({ where: { scanRunId }, select: { offerId: true }, distinct: ["offerId"] })
    .then((rows) => rows.map((r) => r.offerId));

  for (const offerId of offerIds) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) continue;

    const departNear = nearbyDates(offer.departDate, 2);
    const returnNear = nearbyDates(offer.returnDate, 2);

    const comparable = await prisma.offer.findMany({
      where: {
        origin: offer.origin,
        destination: offer.destination,
        cabin: offer.cabin,
        stopsCategory: offer.stopsCategory,
        departDate: { in: departNear },
        returnDate: { in: returnNear },
      },
      select: { priceTotalCents: true, totalTripMinutes: true },
      take: 250,
    });

    const since = DateTime.utc().minus({ days: 7 }).toJSDate();
    const priceHistory7d = await prisma.priceHistory.findMany({
      where: { offerId: offer.id, capturedAt: { gte: since } },
      select: { priceTotalCents: true, capturedAt: true },
      orderBy: { capturedAt: "asc" },
    });

    const metrics = computeDealMetrics({
      offer: {
        origin: offer.origin,
        destination: offer.destination,
        cabin: offer.cabin,
        stopsCategory: offer.stopsCategory,
        stopsTotal: offer.stopsTotal,
        priceTotalCents: offer.priceTotalCents,
        currency: offer.currency,
        totalTripMinutes: offer.totalTripMinutes,
      },
      comparable,
      priceHistory7d,
    });

    await prisma.offer.update({
      where: { id: offer.id },
      data: {
        dealScore: metrics.dealScore,
        isGreatDeal: metrics.isGreatDeal,
        dealRationale: metrics.rationale,
        pricePercentile: metrics.pricePercentile,
        comparableMedianPriceCents: metrics.comparableMedianPriceCents,
        priceDrop7dPct: metrics.priceDrop7dPct,
        durationVsMedianMinutes: metrics.durationVsMedianMinutes,
      },
    });
  }
}
