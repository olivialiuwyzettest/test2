import { env } from "@/lib/config/env";
import { AmadeusProvider } from "@/lib/providers/amadeus";
import { MockProvider } from "@/lib/providers/mock";
import type { FlightProvider } from "@/lib/providers/types";

export function getProvider(id?: string): FlightProvider {
  const providerId = (id ?? env().FLIGHT_PROVIDER ?? "mock").toLowerCase();
  switch (providerId) {
    case "amadeus":
      return new AmadeusProvider();
    case "mock":
      return new MockProvider();
    default:
      return new MockProvider();
  }
}

