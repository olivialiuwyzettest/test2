import type { CabinClass, Prisma, PrismaClient, ScanRunStatus, StopsCategory } from "@prisma/client";

export async function createScanRun(
  prisma: PrismaClient,
  input: {
    provider: string;
    configJson: Prisma.InputJsonValue;
  },
) {
  return prisma.scanRun.create({
    data: {
      provider: input.provider,
      configJson: input.configJson,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
}

export async function finishScanRun(
  prisma: PrismaClient,
  input: {
    scanRunId: string;
    status: ScanRunStatus;
    finishedAt?: Date;
    combosTotal: number;
    combosSkippedSchedule: number;
    queriesNonstop: number;
    queriesOneStop: number;
    offersFound: number;
    offersUpserted: number;
    offersUpdated: number;
    errorsJson?: Prisma.InputJsonValue;
  },
) {
  return prisma.scanRun.update({
    where: { id: input.scanRunId },
    data: {
      status: input.status,
      finishedAt: input.finishedAt ?? new Date(),
      combosTotal: input.combosTotal,
      combosSkippedSchedule: input.combosSkippedSchedule,
      queriesNonstop: input.queriesNonstop,
      queriesOneStop: input.queriesOneStop,
      offersFound: input.offersFound,
      offersUpserted: input.offersUpserted,
      offersUpdated: input.offersUpdated,
      errorsJson: input.errorsJson,
    },
  });
}

export async function upsertOfferWithPriceHistory(
  prisma: PrismaClient,
  input: {
    scanRunId: string;
    offer: {
      provider: string;
      providerOfferId?: string;
      offerKey: string;
      origin: string;
      destination: string;
      departDate: string;
      returnDate: string;
      cabin: CabinClass;
      stopsTotal: number;
      stopsCategory: StopsCategory;
      overnightLayover: boolean;
      segmentsJson: Prisma.InputJsonValue;
      totalDurationOutboundMinutes?: number | null;
      totalDurationInboundMinutes?: number | null;
      totalTripMinutes?: number | null;
      currency: string;
      priceTotalCents: number;
      groupAdults: number;
      groupChildren: number;
      pricePerAdultCents?: number | null;
      pricePerChildCents?: number | null;
      deepLink?: string | null;
      rawPayload?: Prisma.InputJsonValue;
    };
  },
): Promise<{ offerId: string; created: boolean }> {
  const key = { provider: input.offer.provider, offerKey: input.offer.offerKey };
  const existing = await prisma.offer.findUnique({ where: { provider_offerKey: key }, select: { id: true } });

  const data: Prisma.OfferUncheckedCreateInput = {
    provider: input.offer.provider,
    providerOfferId: input.offer.providerOfferId ?? null,
    offerKey: input.offer.offerKey,
    origin: input.offer.origin,
    destination: input.offer.destination,
    departDate: input.offer.departDate,
    returnDate: input.offer.returnDate,
    cabin: input.offer.cabin,
    stopsTotal: input.offer.stopsTotal,
    stopsCategory: input.offer.stopsCategory,
    overnightLayover: input.offer.overnightLayover,
    segmentsJson: input.offer.segmentsJson,
    totalDurationOutboundMinutes: input.offer.totalDurationOutboundMinutes ?? null,
    totalDurationInboundMinutes: input.offer.totalDurationInboundMinutes ?? null,
    totalTripMinutes: input.offer.totalTripMinutes ?? null,
    currency: input.offer.currency,
    priceTotalCents: input.offer.priceTotalCents,
    groupAdults: input.offer.groupAdults,
    groupChildren: input.offer.groupChildren,
    pricePerAdultCents: input.offer.pricePerAdultCents ?? null,
    pricePerChildCents: input.offer.pricePerChildCents ?? null,
    deepLink: input.offer.deepLink ?? null,
    rawPayload: input.offer.rawPayload ?? undefined,
    lastSeenAt: new Date(),
  };

  const offerRow = existing
    ? await prisma.offer.update({ where: { id: existing.id }, data })
    : await prisma.offer.create({ data });

  await prisma.priceHistory.create({
    data: {
      offerId: offerRow.id,
      scanRunId: input.scanRunId,
      capturedAt: new Date(),
      currency: offerRow.currency,
      priceTotalCents: offerRow.priceTotalCents,
      rawPrice: { providerOfferId: offerRow.providerOfferId ?? null },
    },
  });

  return { offerId: offerRow.id, created: !existing };
}

export async function incrementProviderQuotaDay(
  prisma: PrismaClient,
  input: {
    provider: string;
    day: string; // YYYY-MM-DD in scan TZ
    requestDelta?: number;
    successDelta?: number;
    errorDelta?: number;
    lastError?: string | null;
  },
) {
  const requestDelta = input.requestDelta ?? 0;
  const successDelta = input.successDelta ?? 0;
  const errorDelta = input.errorDelta ?? 0;

  return prisma.providerQuotaDay.upsert({
    where: { provider_day: { provider: input.provider, day: input.day } },
    create: {
      provider: input.provider,
      day: input.day,
      requestCount: requestDelta,
      successCount: successDelta,
      errorCount: errorDelta,
      lastError: input.lastError ?? null,
    },
    update: {
      requestCount: { increment: requestDelta },
      successCount: { increment: successDelta },
      errorCount: { increment: errorDelta },
      lastError: input.lastError ?? undefined,
    },
  });
}
