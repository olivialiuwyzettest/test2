import airportsAsia from "@/data/airports_asia.json";

export type Airport = {
  iata: string;
  name: string;
  city: string;
  country: string;
  region?: string;
};

const FALLBACK_ASIA_HUBS: Airport[] = [
  { iata: "HND", name: "Tokyo Haneda", city: "Tokyo", country: "Japan", region: "East Asia" },
  { iata: "NRT", name: "Tokyo Narita", city: "Tokyo", country: "Japan", region: "East Asia" },
  { iata: "ICN", name: "Incheon International", city: "Seoul", country: "South Korea", region: "East Asia" },
  { iata: "SIN", name: "Singapore Changi", city: "Singapore", country: "Singapore", region: "Southeast Asia" },
  { iata: "HKG", name: "Hong Kong International", city: "Hong Kong", country: "Hong Kong", region: "East Asia" },
  { iata: "TPE", name: "Taiwan Taoyuan", city: "Taipei", country: "Taiwan", region: "East Asia" },
  { iata: "BKK", name: "Suvarnabhumi", city: "Bangkok", country: "Thailand", region: "Southeast Asia" },
  { iata: "KUL", name: "Kuala Lumpur International", city: "Kuala Lumpur", country: "Malaysia", region: "Southeast Asia" },
  { iata: "MNL", name: "Ninoy Aquino International", city: "Manila", country: "Philippines", region: "Southeast Asia" },
  { iata: "DEL", name: "Indira Gandhi International", city: "Delhi", country: "India", region: "South Asia" },
  { iata: "BOM", name: "Chhatrapati Shivaji Maharaj", city: "Mumbai", country: "India", region: "South Asia" },
  { iata: "SGN", name: "Tan Son Nhat", city: "Ho Chi Minh City", country: "Vietnam", region: "Southeast Asia" },
  { iata: "HAN", name: "Noi Bai", city: "Hanoi", country: "Vietnam", region: "Southeast Asia" },
  { iata: "CGK", name: "Soekarno-Hatta", city: "Jakarta", country: "Indonesia", region: "Southeast Asia" },
];

function normalizeIata(code: string): string {
  return code.trim().toUpperCase();
}

export function getAsiaAirports(options?: {
  limit?: number;
  includeIatas?: string[];
}): Airport[] {
  const includeSet = new Set((options?.includeIatas ?? []).map(normalizeIata));

  const dataset: Airport[] = Array.isArray(airportsAsia) ? (airportsAsia as Airport[]) : [];
  const base = dataset.length > 0 ? dataset : FALLBACK_ASIA_HUBS;

  const filtered = base
    .filter((a) => a?.iata && a?.name)
    .map((a) => ({
      ...a,
      iata: normalizeIata(a.iata),
    }))
    .filter((a) => (includeSet.size > 0 ? includeSet.has(a.iata) : true));

  // Stable output for deterministic scans/tests.
  filtered.sort((a, b) => a.iata.localeCompare(b.iata));

  const limit = options?.limit;
  return typeof limit === "number" && limit > 0 ? filtered.slice(0, limit) : filtered;
}

export function getAsiaDestinationIatas(options?: {
  limit?: number;
  includeIatas?: string[];
}): string[] {
  return getAsiaAirports(options).map((a) => a.iata);
}

