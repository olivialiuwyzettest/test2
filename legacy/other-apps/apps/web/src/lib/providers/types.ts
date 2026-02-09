import type { CabinClass, StopsCategory } from "@prisma/client";

export type Direction = "OUTBOUND" | "INBOUND";

export type Segment = {
  carrierCode: string;
  flightNumber: string;
  from: string;
  to: string;
  departLocal: string; // ISO-like local timestamp from provider (no TZ required)
  arriveLocal: string; // ISO-like local timestamp from provider (no TZ required)
};

export type NormalizedOffer = {
  provider: string;
  providerOfferId?: string;
  offerKey: string;

  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate: string; // YYYY-MM-DD

  cabin: CabinClass;
  currency: string;
  priceTotalCents: number;

  groupAdults: number;
  groupChildren: number;
  pricePerAdultCents?: number;
  pricePerChildCents?: number;

  deepLink?: string;

  outbound: {
    segments: Segment[];
    durationMinutes?: number;
  };
  inbound: {
    segments: Segment[];
    durationMinutes?: number;
  };

  stopsTotal: number;
  stopsCategory: StopsCategory;
  overnightLayover: boolean;
  totalTripMinutes?: number;

  rawPayload?: unknown;
};

export type FlightSearchParams = {
  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate: string; // YYYY-MM-DD
  cabin: CabinClass;

  adults: number;
  children: number;
  childAges?: number[];

  currency: string;
  nonstopOnly: boolean;
  maxOffers: number;
};

export type FlightProvider = {
  id: string;
  displayName: string;

  // Many airlines open schedules ~330-355 days out. If a date is beyond this,
  // the scanner can skip and mark "schedule not published" instead of burning API quota.
  maxDaysAhead?: number;

  searchRoundtrip(params: FlightSearchParams): Promise<NormalizedOffer[]>;
};

