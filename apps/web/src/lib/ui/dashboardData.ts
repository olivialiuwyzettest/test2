import type { Offer, Prisma, PrismaClient, ProviderQuotaDay, ScanRun } from "@prisma/client";
import { DateTime } from "luxon";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

export type DashboardFilters = {
  origin?: string;
  destination?: string;
  departFrom?: string;
  departTo?: string;
  returnFrom?: string;
  returnTo?: string;
  nonstopOnly?: boolean;
  overnightOnly?: boolean;
  maxStopsTotal?: number;
  sort?: "dealScore" | "totalPrice" | "duration";
};

export type DashboardData = {
  topDeals: Offer[];
  offers: Offer[];
  latestScanRun: ScanRun | null;
  quotaToday: ProviderQuotaDay[];
};

function scanDayInTz(): string {
  const tz = env().SCAN_TIMEZONE;
  return DateTime.now().setZone(tz).toISODate()!;
}

export async function getDashboardData(prisma: PrismaClient, filters: DashboardFilters): Promise<DashboardData> {
  const where: Prisma.OfferWhereInput = {};

  if (filters.origin) where.origin = filters.origin;
  if (filters.destination) where.destination = filters.destination;
  if (filters.departFrom || filters.departTo) {
    where.departDate = {};
    if (filters.departFrom) where.departDate.gte = filters.departFrom;
    if (filters.departTo) where.departDate.lte = filters.departTo;
  }
  if (filters.returnFrom || filters.returnTo) {
    where.returnDate = {};
    if (filters.returnFrom) where.returnDate.gte = filters.returnFrom;
    if (filters.returnTo) where.returnDate.lte = filters.returnTo;
  }
  if (filters.nonstopOnly) where.stopsTotal = 0;
  else if (typeof filters.maxStopsTotal === "number") where.stopsTotal = { lte: filters.maxStopsTotal };
  if (filters.overnightOnly) where.stopsCategory = "ONE_STOP_OVERNIGHT";

  const sort = filters.sort ?? "dealScore";
  const orderBy =
    sort === "totalPrice"
      ? [{ priceTotalCents: "asc" as const }, { dealScore: "desc" as const }]
      : sort === "duration"
        ? [{ totalTripMinutes: "asc" as const }, { dealScore: "desc" as const }]
        : [{ isGreatDeal: "desc" as const }, { dealScore: "desc" as const }, { priceTotalCents: "asc" as const }];

  try {
    const [topDeals, offers, latestScanRun, quotaToday] = await Promise.all([
      prisma.offer.findMany({
        where: { ...where, isGreatDeal: true },
        orderBy: [{ dealScore: "desc" }, { priceTotalCents: "asc" }],
        take: 3,
      }),
      prisma.offer.findMany({
        where,
        orderBy,
        take: 100,
      }),
      prisma.scanRun.findFirst({ orderBy: { startedAt: "desc" } }),
      prisma.providerQuotaDay.findMany({ where: { day: scanDayInTz() }, orderBy: { provider: "asc" } }),
    ]);

    return { topDeals, offers, latestScanRun, quotaToday };
  } catch (err) {
    logger.warn("Dashboard query failed (db not initialized yet?)", { error: err instanceof Error ? err.message : String(err) });
    return { topDeals: [], offers: [], latestScanRun: null, quotaToday: [] };
  }
}
