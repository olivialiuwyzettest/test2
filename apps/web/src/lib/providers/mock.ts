import type { CabinClass, StopsCategory } from "@prisma/client";
import crypto from "node:crypto";
import { addDays } from "@/lib/utils/date";
import { computeOfferKey } from "@/lib/providers/offerKey";
import type { FlightProvider, FlightSearchParams, NormalizedOffer, Segment } from "@/lib/providers/types";

function hashInt(input: string): number {
  const hex = crypto.createHash("sha256").update(input).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16);
}

const NONSTOP_ROUTES = new Set([
  "SEA-HND",
  "SEA-ICN",
  "SEA-NRT",
  "YVR-HND",
  "YVR-ICN",
  "YVR-NRT",
]);

function makeSegment(partial: Omit<Segment, "carrierCode" | "flightNumber"> & { carrierCode?: string; flightNumber?: string }): Segment {
  return {
    carrierCode: partial.carrierCode ?? "MO",
    flightNumber: partial.flightNumber ?? String(100 + (hashInt(`${partial.from}${partial.to}${partial.departLocal}`) % 800)),
    from: partial.from,
    to: partial.to,
    departLocal: partial.departLocal,
    arriveLocal: partial.arriveLocal,
  };
}

function cents(n: number): number {
  return Math.round(n);
}

function buildNonstopOffer(params: FlightSearchParams, routeSeed: number): NormalizedOffer {
  const pax = params.adults + params.children;

  const basePerPax = 340_000 + (routeSeed % 90_000); // $3.4k - $4.3k
  const dateSeed = hashInt(`${params.departDate}|${params.returnDate}`) % 100;
  const discount = dateSeed < 12 ? 0.78 : dateSeed < 25 ? 0.88 : 1.0;

  const perPax = cents(basePerPax * discount);
  const priceTotalCents = perPax * pax;

  const outboundDepart = `${params.departDate}T12:30:00`;
  const outboundArrive = `${addDays(params.departDate, 1)}T16:15:00`;
  const inboundDepart = `${params.returnDate}T16:55:00`;
  const inboundArrive = `${addDays(params.returnDate, 0)}T11:10:00`; // intentionally "local-ish"

  const outboundSegments = [
    makeSegment({
      from: params.origin,
      to: params.destination,
      departLocal: outboundDepart,
      arriveLocal: outboundArrive,
    }),
  ];
  const inboundSegments = [
    makeSegment({
      from: params.destination,
      to: params.origin,
      departLocal: inboundDepart,
      arriveLocal: inboundArrive,
    }),
  ];

  const offerBase: Omit<NormalizedOffer, "offerKey"> = {
    provider: "mock",
    providerOfferId: `mock_${params.origin}_${params.destination}_${params.departDate}_${params.returnDate}_NS`,
    origin: params.origin,
    destination: params.destination,
    departDate: params.departDate,
    returnDate: params.returnDate,
    cabin: params.cabin,
    currency: params.currency,
    priceTotalCents,
    groupAdults: params.adults,
    groupChildren: params.children,
    outbound: { segments: outboundSegments, durationMinutes: 655 },
    inbound: { segments: inboundSegments, durationMinutes: 605 },
    stopsTotal: 0,
    stopsCategory: "NONSTOP" satisfies StopsCategory,
    overnightLayover: false,
    totalTripMinutes: 1260,
    deepLink: undefined,
    rawPayload: { mock: true, kind: "nonstop" },
  };

  return { ...offerBase, offerKey: computeOfferKey(offerBase) };
}

function buildOneStopOvernightOffer(params: FlightSearchParams, routeSeed: number): NormalizedOffer {
  const pax = params.adults + params.children;

  const basePerPax = 300_000 + (routeSeed % 80_000); // $3.0k - $3.8k
  const dateSeed = hashInt(`${params.origin}|${params.destination}|${params.departDate}`) % 100;
  const discount = dateSeed < 18 ? 0.76 : dateSeed < 35 ? 0.9 : 1.02;
  const perPax = cents(basePerPax * discount);
  const priceTotalCents = perPax * pax;

  // Single overnight stop on the outbound; inbound is nonstop.
  const connection = ["YVR", "SEA"].includes(params.origin) ? "HNL" : "ICN";

  const seg1Depart = `${params.departDate}T16:05:00`;
  const seg1Arrive = `${params.departDate}T23:05:00`;
  const seg2Depart = `${addDays(params.departDate, 1)}T07:45:00`; // crosses midnight, >= 8h layover
  const seg2Arrive = `${addDays(params.departDate, 1)}T12:35:00`;

  const outboundSegments = [
    makeSegment({
      from: params.origin,
      to: connection,
      departLocal: seg1Depart,
      arriveLocal: seg1Arrive,
      flightNumber: String(200 + (routeSeed % 500)),
    }),
    makeSegment({
      from: connection,
      to: params.destination,
      departLocal: seg2Depart,
      arriveLocal: seg2Arrive,
      flightNumber: String(700 + (routeSeed % 200)),
    }),
  ];

  const inboundDepart = `${params.returnDate}T15:25:00`;
  const inboundArrive = `${addDays(params.returnDate, 0)}T10:35:00`;
  const inboundSegments = [
    makeSegment({
      from: params.destination,
      to: params.origin,
      departLocal: inboundDepart,
      arriveLocal: inboundArrive,
      flightNumber: String(300 + (routeSeed % 500)),
    }),
  ];

  const offerBase: Omit<NormalizedOffer, "offerKey"> = {
    provider: "mock",
    providerOfferId: `mock_${params.origin}_${params.destination}_${params.departDate}_${params.returnDate}_OVN`,
    origin: params.origin,
    destination: params.destination,
    departDate: params.departDate,
    returnDate: params.returnDate,
    cabin: params.cabin as CabinClass,
    currency: params.currency,
    priceTotalCents,
    groupAdults: params.adults,
    groupChildren: params.children,
    outbound: { segments: outboundSegments, durationMinutes: 1200 },
    inbound: { segments: inboundSegments, durationMinutes: 635 },
    stopsTotal: 1,
    stopsCategory: "ONE_STOP_OVERNIGHT" satisfies StopsCategory,
    overnightLayover: true,
    totalTripMinutes: 1835,
    deepLink: undefined,
    rawPayload: { mock: true, kind: "one_stop_overnight", connection },
  };

  return { ...offerBase, offerKey: computeOfferKey(offerBase) };
}

export class MockProvider implements FlightProvider {
  id = "mock";
  displayName = "Mock Provider (Deterministic)";
  maxDaysAhead = 5000;

  async searchRoundtrip(params: FlightSearchParams): Promise<NormalizedOffer[]> {
    const route = `${params.origin}-${params.destination}`;
    const routeSeed = hashInt(route);
    const comboSeed = hashInt(`${route}|${params.departDate}|${params.returnDate}|${params.nonstopOnly}`);

    if (params.nonstopOnly) {
      if (!NONSTOP_ROUTES.has(route)) return [];
      // Some date pairs "sell out" deterministically.
      if (comboSeed % 7 === 0) return [];
      return [buildNonstopOffer(params, routeSeed)];
    }

    // One-stop query. Only return offers when deterministic availability exists.
    if (comboSeed % 3 !== 0) return [];
    return [buildOneStopOvernightOffer(params, routeSeed)];
  }
}

