import type { CabinClass, Prisma, PrismaClient, StopsCategory } from "@prisma/client";
import { DateTime } from "luxon";
import { env } from "@/lib/config/env";
import { defaultTripConfig, type TripSearchConfig } from "@/lib/config/tripConfig";
import { createScanRun, finishScanRun, incrementProviderQuotaDay, upsertOfferWithPriceHistory } from "@/lib/db/repository";
import { computeLayovers } from "@/lib/itinerary/layovers";
import { logger } from "@/lib/logger";
import { getProvider } from "@/lib/providers";
import type { FlightSearchParams, NormalizedOffer } from "@/lib/providers/types";
import { recomputeDealScoresForScanRun } from "@/lib/scoring/dealScore";
import { generateDatePairs } from "@/lib/searchSpace/datePairs";
import { daysFromTodayUtc } from "@/lib/utils/date";

type Combo = {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
};

export type ScanResult = {
  scanRunId: string;
  provider: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  stats: {
    combosTotal: number;
    combosSkippedSchedule: number;
    queriesNonstop: number;
    queriesOneStop: number;
    offersFound: number;
    offersUpserted: number;
    offersUpdated: number;
    errors: Array<{ combo: Combo; message: string }>;
  };
};

function scanDayInTz(): string {
  const tz = env().SCAN_TIMEZONE;
  return DateTime.now().setZone(tz).toISODate()!;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeRetriableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /\((\d{3})\)/.exec(msg);
  const status = m ? Number(m[1]) : null;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function asyncPool<T, R>(limit: number, items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const ret: R[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const p: Promise<void> = (async () => {
      try {
        const r = await fn(item);
        ret.push(r);
      } catch {
        // Errors are handled in the caller; keep the pool draining.
      }
    })();
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) await Promise.race(executing);
  }

  await Promise.allSettled(executing);
  return ret;
}

function enrichOfferForFiltering(offer: NormalizedOffer, overnightMinHours: number): {
  offer: NormalizedOffer & { stopsTotal: number; stopsCategory: StopsCategory; overnightLayover: boolean };
  segmentsJson: Prisma.InputJsonValue;
  outboundStops: number;
  inboundStops: number;
  outboundHasOvernight: boolean;
  inboundHasOvernight: boolean;
  overnightCount: number;
} {
  const outboundLayovers = computeLayovers(offer.outbound.segments, overnightMinHours);
  const inboundLayovers = computeLayovers(offer.inbound.segments, overnightMinHours);

  const outboundStops = outboundLayovers.stops;
  const inboundStops = inboundLayovers.stops;
  const stopsTotal = outboundStops + inboundStops;

  const outboundHasOvernight = outboundLayovers.hasAnyOvernight;
  const inboundHasOvernight = inboundLayovers.hasAnyOvernight;
  const overnightLayover = outboundHasOvernight || inboundHasOvernight;
  const overnightCount =
    outboundLayovers.layovers.filter((l) => l.isOvernight).length + inboundLayovers.layovers.filter((l) => l.isOvernight).length;

  const stopsCategory: StopsCategory = (stopsTotal === 0 ? "NONSTOP" : "ONE_STOP_OVERNIGHT") satisfies StopsCategory;
  const segmentsJson = {
    outbound: offer.outbound.segments,
    inbound: offer.inbound.segments,
    layovers: {
      outbound: outboundLayovers.layovers,
      inbound: inboundLayovers.layovers,
    },
  };

  return {
    offer: { ...offer, stopsTotal, stopsCategory, overnightLayover },
    segmentsJson,
    outboundStops,
    inboundStops,
    outboundHasOvernight,
    inboundHasOvernight,
    overnightCount,
  };
}

function shouldSkipForSchedule(providerMaxDaysAhead: number | undefined, combo: Combo): boolean {
  if (!providerMaxDaysAhead) return false;
  return daysFromTodayUtc(combo.departDate) > providerMaxDaysAhead || daysFromTodayUtc(combo.returnDate) > providerMaxDaysAhead;
}

export async function runScanNow(prisma: PrismaClient, options?: { providerId?: string; configOverride?: Partial<TripSearchConfig> }): Promise<ScanResult> {
  const baseConfig = defaultTripConfig();
  const config: TripSearchConfig = { ...baseConfig, ...(options?.configOverride ?? {}) };
  const provider = getProvider(options?.providerId);

  const scanRun = await createScanRun(prisma, { provider: provider.id, configJson: config as unknown as Prisma.InputJsonValue });
  logger.info("Scan started", { scanRunId: scanRun.id, provider: provider.id });

  const datePairs = generateDatePairs({
    departStart: config.departStart,
    departEnd: config.departEnd,
    returnStart: config.returnStart,
    returnEnd: config.returnEnd,
    minNights: config.minNights,
    maxNights: config.maxNights,
  });

  const combos: Combo[] = [];
  for (const origin of config.origins) {
    for (const destination of config.destinations) {
      for (const p of datePairs) {
        combos.push({ origin, destination, departDate: p.departDate, returnDate: p.returnDate });
      }
    }
  }

  const combosLimited = combos.slice(0, config.scan.maxCombos);

  const stats: ScanResult["stats"] = {
    combosTotal: combosLimited.length,
    combosSkippedSchedule: 0,
    queriesNonstop: 0,
    queriesOneStop: 0,
    offersFound: 0,
    offersUpserted: 0,
    offersUpdated: 0,
    errors: [],
  };

  const quotaDay = scanDayInTz();

  async function trackedSearch(params: FlightSearchParams): Promise<NormalizedOffer[]> {
    await incrementProviderQuotaDay(prisma, { provider: provider.id, day: quotaDay, requestDelta: 1 });
    try {
      const offers = await provider.searchRoundtrip(params);
      await incrementProviderQuotaDay(prisma, { provider: provider.id, day: quotaDay, successDelta: 1 });
      return offers;
    } catch (err) {
      await incrementProviderQuotaDay(prisma, {
        provider: provider.id,
        day: quotaDay,
        errorDelta: 1,
        lastError: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
      });
      throw err;
    }
  }

  async function searchWithRetries(params: FlightSearchParams): Promise<NormalizedOffer[]> {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await trackedSearch(params);
      } catch (err) {
        if (attempt >= maxRetries || !looksLikeRetriableError(err)) throw err;
        const backoffMs = Math.round(500 * Math.pow(2, attempt) + Math.random() * 250);
        logger.warn("Retrying provider request", { attempt, backoffMs, error: err instanceof Error ? err.message : String(err) });
        await sleep(backoffMs);
      }
    }
    return [];
  }

  await asyncPool(config.scan.concurrency, combosLimited, async (combo) => {
    if (shouldSkipForSchedule(provider.maxDaysAhead, combo)) {
      stats.combosSkippedSchedule += 1;
      return;
    }

    const baseParams: Omit<FlightSearchParams, "nonstopOnly"> = {
      origin: combo.origin,
      destination: combo.destination,
      departDate: combo.departDate,
      returnDate: combo.returnDate,
      cabin: config.cabin as CabinClass,
      adults: config.passengers.adults,
      children: config.passengers.children,
      childAges: config.passengers.childAges,
      currency: config.currency,
      maxOffers: config.scan.maxOffersPerQuery,
    };

    try {
      // 1) Nonstop query first.
      stats.queriesNonstop += 1;
      const nonstopRaw = await searchWithRetries({ ...baseParams, nonstopOnly: true });
      const nonstop: Array<NormalizedOffer & { segmentsJson: Prisma.InputJsonValue }> = nonstopRaw
        .map((o) => enrichOfferForFiltering(o, config.overnightMinHours))
        .filter((x) => x.offer.stopsTotal === 0)
        .map((x) => ({ ...x.offer, segmentsJson: x.segmentsJson }));

      let chosen: Array<NormalizedOffer & { segmentsJson: Prisma.InputJsonValue }> = nonstop;

      // 2) Fallback to 1-stop results (filtered to exactly one overnight connection).
      if (chosen.length === 0 && config.maxStopsTotal >= 1) {
        stats.queriesOneStop += 1;
        const oneStopRaw = await searchWithRetries({ ...baseParams, nonstopOnly: false });
        const oneStopFiltered: Array<NormalizedOffer & { segmentsJson: Prisma.InputJsonValue }> = oneStopRaw
          .map((o) => enrichOfferForFiltering(o, config.overnightMinHours))
          .filter((x) => x.outboundStops + x.inboundStops > 0)
          .filter((x) => x.outboundStops + x.inboundStops <= config.maxStopsTotal)
          .filter((x) => x.overnightCount === 1)
          .map((x) => ({ ...x.offer, segmentsJson: x.segmentsJson }));

        chosen = oneStopFiltered;
      }

      if (chosen.length === 0) return;

      // Dedupe by offerKey within the query.
      const byKey = new Map<string, NormalizedOffer & { segmentsJson: Prisma.InputJsonValue }>();
      for (const o of chosen) {
        const existing = byKey.get(o.offerKey);
        if (!existing || o.priceTotalCents < existing.priceTotalCents) byKey.set(o.offerKey, o);
      }
      const uniqueOffers = Array.from(byKey.values());

      stats.offersFound += uniqueOffers.length;

      for (const o of uniqueOffers) {
        const persisted = await upsertOfferWithPriceHistory(prisma, {
          scanRunId: scanRun.id,
          offer: {
            provider: o.provider,
            providerOfferId: o.providerOfferId,
            offerKey: o.offerKey,
            origin: o.origin,
            destination: o.destination,
            departDate: o.departDate,
            returnDate: o.returnDate,
            cabin: o.cabin,
            stopsTotal: o.stopsTotal,
            stopsCategory: o.stopsCategory,
            overnightLayover: o.overnightLayover,
            segmentsJson: o.segmentsJson,
            totalDurationOutboundMinutes: o.outbound.durationMinutes ?? null,
            totalDurationInboundMinutes: o.inbound.durationMinutes ?? null,
            totalTripMinutes: o.totalTripMinutes ?? null,
            currency: o.currency,
            priceTotalCents: o.priceTotalCents,
            groupAdults: o.groupAdults,
            groupChildren: o.groupChildren,
            pricePerAdultCents: o.pricePerAdultCents ?? null,
            pricePerChildCents: o.pricePerChildCents ?? null,
            deepLink: o.deepLink ?? null,
            rawPayload: o.rawPayload as unknown as Prisma.InputJsonValue,
          },
        });
        if (persisted.created) stats.offersUpserted += 1;
        else stats.offersUpdated += 1;
      }
    } catch (err) {
      stats.errors.push({ combo, message: err instanceof Error ? err.message : String(err) });
      logger.error("Combo failed", { combo, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Score offers seen in this scan run.
  try {
    await recomputeDealScoresForScanRun(prisma, scanRun.id);
  } catch (err) {
    stats.errors.push({ combo: { origin: "SYSTEM", destination: "SYSTEM", departDate: "0000-00-00", returnDate: "0000-00-00" }, message: `Scoring failed: ${err instanceof Error ? err.message : String(err)}` });
    logger.error("Scoring failed", { scanRunId: scanRun.id, error: err instanceof Error ? err.message : String(err) });
  }

  const status: ScanResult["status"] = stats.errors.length === 0 ? "SUCCESS" : stats.offersFound > 0 ? "PARTIAL" : "FAILED";

  await finishScanRun(prisma, {
    scanRunId: scanRun.id,
    status,
    combosTotal: stats.combosTotal,
    combosSkippedSchedule: stats.combosSkippedSchedule,
    queriesNonstop: stats.queriesNonstop,
    queriesOneStop: stats.queriesOneStop,
    offersFound: stats.offersFound,
    offersUpserted: stats.offersUpserted,
    offersUpdated: stats.offersUpdated,
    errorsJson: stats.errors.length > 0 ? stats.errors : undefined,
  });

  logger.info("Scan finished", { scanRunId: scanRun.id, status, offersFound: stats.offersFound });

  return {
    scanRunId: scanRun.id,
    provider: provider.id,
    status,
    stats,
  };
}
