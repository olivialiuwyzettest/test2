import type { CabinClass, StopsCategory } from "@prisma/client";
import { env } from "@/lib/config/env";
import { computeOfferKey } from "@/lib/providers/offerKey";
import type { FlightProvider, FlightSearchParams, NormalizedOffer, Segment } from "@/lib/providers/types";

type AmadeusTokenResponse = {
  access_token: string;
  expires_in: number; // seconds
  token_type: string;
};

type AmadeusSegment = {
  carrierCode?: string;
  number?: string;
  marketingCarrierCode?: string;
  flightNumber?: string;
  departure?: { iataCode?: string; iata?: string; at?: string; time?: string };
  arrival?: { iataCode?: string; iata?: string; at?: string; time?: string };
};

type AmadeusItinerary = {
  duration?: string;
  segments?: AmadeusSegment[];
};

type AmadeusFlightOffer = {
  id?: string;
  itineraries?: AmadeusItinerary[];
  price?: { currency?: string; grandTotal?: string; total?: string };
};

type AmadeusFlightOffersResponse = {
  data?: AmadeusFlightOffer[];
};

function parseMoneyToCents(value: string): number {
  // "1234.56" -> 123456
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function parseDurationToMinutes(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  // Examples: "PT13H20M", "PT55M"
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso);
  if (!m) return undefined;
  const hours = m[1] ? Number(m[1]) : 0;
  const mins = m[2] ? Number(m[2]) : 0;
  return hours * 60 + mins;
}

function mapSegment(seg: AmadeusSegment): Segment {
  return {
    carrierCode: String(seg?.carrierCode ?? seg?.marketingCarrierCode ?? "??"),
    flightNumber: String(seg?.number ?? seg?.flightNumber ?? "0"),
    from: String(seg?.departure?.iataCode ?? seg?.departure?.iata ?? "???"),
    to: String(seg?.arrival?.iataCode ?? seg?.arrival?.iata ?? "???"),
    departLocal: String(seg?.departure?.at ?? seg?.departure?.time ?? ""),
    arriveLocal: String(seg?.arrival?.at ?? seg?.arrival?.time ?? ""),
  };
}

export class AmadeusProvider implements FlightProvider {
  id = "amadeus";
  displayName = "Amadeus Self-Service API";
  maxDaysAhead = 330;

  private host: string;
  private clientId: string;
  private clientSecret: string;
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor() {
    const e = env();
    if (!e.AMADEUS_CLIENT_ID || !e.AMADEUS_CLIENT_SECRET) {
      throw new Error("AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET are required for the Amadeus provider.");
    }
    this.host = e.AMADEUS_HOST.replace(/\/+$/, "");
    this.clientId = e.AMADEUS_CLIENT_ID;
    this.clientSecret = e.AMADEUS_CLIENT_SECRET;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAtMs - 30_000 > now) return this.token.value;

    const url = `${this.host}/v1/security/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Amadeus token error (${res.status}): ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as AmadeusTokenResponse;
    const expiresAtMs = now + (json.expires_in ?? 0) * 1000;
    this.token = { value: json.access_token, expiresAtMs };
    return json.access_token;
  }

  async searchRoundtrip(params: FlightSearchParams): Promise<NormalizedOffer[]> {
    const token = await this.getAccessToken();
    const url = new URL(`${this.host}/v2/shopping/flight-offers`);
    url.searchParams.set("originLocationCode", params.origin);
    url.searchParams.set("destinationLocationCode", params.destination);
    url.searchParams.set("departureDate", params.departDate);
    url.searchParams.set("returnDate", params.returnDate);
    url.searchParams.set("adults", String(params.adults));
    if (params.children > 0) url.searchParams.set("children", String(params.children));
    url.searchParams.set("travelClass", "BUSINESS");
    url.searchParams.set("nonStop", params.nonstopOnly ? "true" : "false");
    url.searchParams.set("currencyCode", params.currency);
    url.searchParams.set("max", String(params.maxOffers));

    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Amadeus search error (${res.status}): ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as AmadeusFlightOffersResponse;
    const data = Array.isArray(json?.data) ? json.data : [];

    const out: NormalizedOffer[] = [];
    for (const offer of data) {
      const itineraries = Array.isArray(offer?.itineraries) ? offer.itineraries : [];
      if (itineraries.length < 2) continue;
      const outItin = itineraries[0];
      const inItin = itineraries[1];

      const outboundSegments = (outItin?.segments ?? []).map(mapSegment).filter((s: Segment) => s.departLocal && s.arriveLocal);
      const inboundSegments = (inItin?.segments ?? []).map(mapSegment).filter((s: Segment) => s.departLocal && s.arriveLocal);
      if (outboundSegments.length === 0 || inboundSegments.length === 0) continue;

      const outboundStops = Math.max(0, outboundSegments.length - 1);
      const inboundStops = Math.max(0, inboundSegments.length - 1);
      const stopsTotal = outboundStops + inboundStops;

      const outboundDuration = parseDurationToMinutes(outItin?.duration);
      const inboundDuration = parseDurationToMinutes(inItin?.duration);
      const totalTripMinutes = (outboundDuration ?? 0) + (inboundDuration ?? 0);

      const currency = String(offer?.price?.currency ?? params.currency ?? "USD");
      const priceTotalCents = parseMoneyToCents(String(offer?.price?.grandTotal ?? offer?.price?.total ?? "0"));

      const offerBase: Omit<NormalizedOffer, "offerKey"> = {
        provider: "amadeus",
        providerOfferId: String(offer?.id ?? ""),
        origin: params.origin,
        destination: params.destination,
        departDate: params.departDate,
        returnDate: params.returnDate,
        cabin: params.cabin as CabinClass,
        currency,
        priceTotalCents,
        groupAdults: params.adults,
        groupChildren: params.children,
        outbound: { segments: outboundSegments, durationMinutes: outboundDuration },
        inbound: { segments: inboundSegments, durationMinutes: inboundDuration },
        stopsTotal,
        stopsCategory: (stopsTotal === 0 ? "NONSTOP" : "ONE_STOP_OVERNIGHT") satisfies StopsCategory,
        overnightLayover: false,
        totalTripMinutes: totalTripMinutes > 0 ? totalTripMinutes : undefined,
        deepLink: undefined,
        rawPayload: offer,
      };

      out.push({ ...offerBase, offerKey: computeOfferKey(offerBase) });
    }

    return out;
  }
}
