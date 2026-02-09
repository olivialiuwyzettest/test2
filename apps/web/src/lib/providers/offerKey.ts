import crypto from "node:crypto";
import type { NormalizedOffer, Segment } from "@/lib/providers/types";

function stableSegmentKey(s: Segment) {
  return {
    carrierCode: s.carrierCode,
    flightNumber: s.flightNumber,
    from: s.from,
    to: s.to,
    departLocal: s.departLocal,
    arriveLocal: s.arriveLocal,
  };
}

export function computeOfferKey(input: Omit<NormalizedOffer, "offerKey">): string {
  const payload = {
    provider: input.provider,
    origin: input.origin,
    destination: input.destination,
    departDate: input.departDate,
    returnDate: input.returnDate,
    cabin: input.cabin,
    groupAdults: input.groupAdults,
    groupChildren: input.groupChildren,
    outbound: input.outbound.segments.map(stableSegmentKey),
    inbound: input.inbound.segments.map(stableSegmentKey),
  };

  const json = JSON.stringify(payload);
  return crypto.createHash("sha256").update(json).digest("hex");
}

