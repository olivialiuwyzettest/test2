import type { PropertyType, ReitUniverseItem } from "./types";

export const PROPERTY_AI_SCORES: Record<PropertyType, number> = {
  data_center: 1.0,
  tower: 0.4,
  industrial: 0.3,
  self_storage: 0.1,
  residential: 0.0,
  healthcare: 0.0,
  net_lease: -0.2,
  office: -1.0,
  lodging: -0.3,
  retail: -0.2,
  gaming: -0.1,
  specialty: 0.1,
  other: 0.0,
};

export const DEFENSIVE_PROPERTY_TYPES = new Set<PropertyType>([
  "residential",
  "healthcare",
  "net_lease",
  "self_storage",
]);

export const CYCLICAL_PROPERTY_TYPES = new Set<PropertyType>([
  "lodging",
  "office",
  "retail",
  "gaming",
]);

export const MORTGAGE_REIT_BLOCKLIST = new Set<string>([
  "AGNC",
  "NLY",
  "RITM",
  "STWD",
  "BXMT",
  "KREF",
  "MFA",
  "TWO",
  "PMT",
  "ABR",
  "EFC",
]);

const BASE_UNIVERSE: Array<Omit<ReitUniverseItem, "aiStructural">> = [
  { ticker: "AMT", name: "American Tower", propertyType: "tower" },
  { ticker: "CCI", name: "Crown Castle", propertyType: "tower" },
  { ticker: "EQIX", name: "Equinix", propertyType: "data_center" },
  { ticker: "DLR", name: "Digital Realty", propertyType: "data_center" },
  { ticker: "PLD", name: "Prologis", propertyType: "industrial" },
  { ticker: "FR", name: "First Industrial Realty Trust", propertyType: "industrial" },
  { ticker: "REXR", name: "Rexford Industrial Realty", propertyType: "industrial" },
  { ticker: "EGP", name: "EastGroup Properties", propertyType: "industrial" },
  { ticker: "STAG", name: "STAG Industrial", propertyType: "industrial" },
  { ticker: "COLD", name: "Americold Realty", propertyType: "industrial" },
  { ticker: "PSA", name: "Public Storage", propertyType: "self_storage" },
  { ticker: "EXR", name: "Extra Space Storage", propertyType: "self_storage" },
  { ticker: "CUBE", name: "CubeSmart", propertyType: "self_storage" },
  { ticker: "AVB", name: "AvalonBay Communities", propertyType: "residential" },
  { ticker: "EQR", name: "Equity Residential", propertyType: "residential" },
  { ticker: "ESS", name: "Essex Property Trust", propertyType: "residential" },
  { ticker: "MAA", name: "Mid-America Apartment Communities", propertyType: "residential" },
  { ticker: "UDR", name: "UDR", propertyType: "residential" },
  { ticker: "INVH", name: "Invitation Homes", propertyType: "residential" },
  { ticker: "CPT", name: "Camden Property Trust", propertyType: "residential" },
  { ticker: "ELS", name: "Equity Lifestyle Properties", propertyType: "residential" },
  { ticker: "SUI", name: "Sun Communities", propertyType: "residential" },
  { ticker: "WELL", name: "Welltower", propertyType: "healthcare" },
  { ticker: "VTR", name: "Ventas", propertyType: "healthcare" },
  { ticker: "DOC", name: "Healthpeak Properties", propertyType: "healthcare" },
  { ticker: "OHI", name: "Omega Healthcare Investors", propertyType: "healthcare" },
  { ticker: "SBRA", name: "Sabra Health Care REIT", propertyType: "healthcare" },
  { ticker: "O", name: "Realty Income", propertyType: "net_lease" },
  { ticker: "NNN", name: "NNN REIT", propertyType: "net_lease" },
  { ticker: "WPC", name: "W. P. Carey", propertyType: "net_lease" },
  { ticker: "ADC", name: "Agree Realty", propertyType: "net_lease" },
  { ticker: "BXP", name: "BXP", propertyType: "office" },
  { ticker: "VNO", name: "Vornado Realty Trust", propertyType: "office" },
  { ticker: "ARE", name: "Alexandria Real Estate Equities", propertyType: "office" },
  { ticker: "SLG", name: "SL Green Realty", propertyType: "office" },
  { ticker: "SPG", name: "Simon Property Group", propertyType: "retail" },
  { ticker: "FRT", name: "Federal Realty Investment Trust", propertyType: "retail" },
  { ticker: "REG", name: "Regency Centers", propertyType: "retail" },
  { ticker: "KIM", name: "Kimco Realty", propertyType: "retail" },
  { ticker: "HST", name: "Host Hotels & Resorts", propertyType: "lodging" },
  { ticker: "RHP", name: "Ryman Hospitality Properties", propertyType: "lodging" },
  { ticker: "PK", name: "Park Hotels & Resorts", propertyType: "lodging" },
  { ticker: "VICI", name: "VICI Properties", propertyType: "gaming" },
  { ticker: "GLPI", name: "Gaming and Leisure Properties", propertyType: "gaming" },
  { ticker: "IRM", name: "Iron Mountain", propertyType: "specialty" },
  { ticker: "EPR", name: "EPR Properties", propertyType: "specialty" },
];

const BASE_UNIVERSE_BY_TICKER = new Map(BASE_UNIVERSE.map((item) => [item.ticker, item]));

export const REIT_SCORE_WEIGHTS = {
  dip: 0.35,
  trend: 0.25,
  macroAlignment: 0.2,
  aiStructural: 0.1,
  liquidity: 0.1,
};

export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function aiScoreToUnit(aiStructural: number): number {
  return Math.max(0, Math.min(1, (aiStructural + 1) / 2));
}

export function getBaseUniverse(): ReitUniverseItem[] {
  return BASE_UNIVERSE.map((item) => ({
    ...item,
    aiStructural: PROPERTY_AI_SCORES[item.propertyType],
  }));
}

export function mapTickerToUniverseItem(ticker: string): ReitUniverseItem {
  const normalized = normalizeTicker(ticker);
  const known = BASE_UNIVERSE_BY_TICKER.get(normalized);

  if (known) {
    return {
      ...known,
      aiStructural: PROPERTY_AI_SCORES[known.propertyType],
    };
  }

  return {
    ticker: normalized,
    name: normalized,
    propertyType: "other",
    aiStructural: PROPERTY_AI_SCORES.other,
  };
}
