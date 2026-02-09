import { env } from "@/lib/config/env";
import { getAsiaDestinationIatas } from "@/lib/searchSpace/airports";

export type PassengerGroup = {
  adults: number;
  children: number;
  childAges: number[];
};

export type TripSearchConfig = {
  origins: string[];
  destinations: string[];

  departStart: string;
  departEnd: string;
  returnStart: string;
  returnEnd: string;
  minNights: number;
  maxNights: number;

  cabin: "BUSINESS";
  currency: string;

  passengers: PassengerGroup;

  preferNonstop: boolean;
  maxStopsTotal: number;
  overnightMinHours: number;

  scan: {
    maxCombos: number;
    maxOffersPerQuery: number;
    concurrency: number;
  };
};

export function totalPassengers(group: PassengerGroup): number {
  return group.adults + group.children;
}

function normalizeIata(code: string): string {
  return code.trim().toUpperCase();
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseChildAges(value: string | undefined, children: number): number[] {
  const parsed = parseCsv(value).map((v) => Number(v)).filter((n) => Number.isFinite(n));
  const out: number[] = [];

  for (let i = 0; i < children; i += 1) {
    const age = parsed[i] ?? 8;
    // Constraint: ages 2-11 (configurable in UI later; this keeps provider inputs sane).
    out.push(Math.min(11, Math.max(2, Math.floor(age))));
  }

  return out;
}

export function defaultTripConfig(): TripSearchConfig {
  const e = env();

  const origins = parseCsv(e.ORIGINS).map(normalizeIata);
  const includeIatas = parseCsv(e.DESTINATIONS_INCLUDE).map(normalizeIata);
  const destinations = getAsiaDestinationIatas({ includeIatas, limit: e.DESTINATIONS_LIMIT });

  return {
    origins: origins.length > 0 ? origins : ["SEA", "YVR"],
    destinations,
    departStart: e.DEPART_START,
    departEnd: e.DEPART_END,
    returnStart: e.RETURN_START,
    returnEnd: e.RETURN_END,
    minNights: e.TRIP_MIN_NIGHTS,
    maxNights: e.TRIP_MAX_NIGHTS,
    cabin: e.CABIN_CLASS,
    currency: e.CURRENCY,
    passengers: {
      adults: e.PASSENGERS_ADULTS,
      children: e.PASSENGERS_CHILDREN,
      childAges: parseChildAges(e.PASSENGERS_CHILD_AGES, e.PASSENGERS_CHILDREN),
    },
    preferNonstop: true,
    maxStopsTotal: e.MAX_STOPS_TOTAL,
    overnightMinHours: e.OVERNIGHT_MIN_HOURS,
    scan: {
      maxCombos: e.SCAN_MAX_COMBOS,
      maxOffersPerQuery: e.SCAN_MAX_OFFERS_PER_QUERY,
      concurrency: e.SCAN_CONCURRENCY,
    },
  };
}

