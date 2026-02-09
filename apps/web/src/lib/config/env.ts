import { z } from "zod";

// Keep this file server-only. Do not import it from Client Components.
const EnvSchema = z.object({
  DATABASE_URL: z.string().optional(),

  FLIGHT_PROVIDER: z.enum(["mock", "amadeus"]).default("mock"),
  SCAN_TIMEZONE: z.string().default("America/Los_Angeles"),
  SCAN_CRON: z.string().default("0 6 * * *"),
  RUN_SCAN_ON_STARTUP: z.string().optional().transform((v) => v === "true"),

  PASSENGERS_ADULTS: z.coerce.number().int().min(1).default(4),
  PASSENGERS_CHILDREN: z.coerce.number().int().min(0).default(2),
  PASSENGERS_CHILD_AGES: z.string().optional(),

  CABIN_CLASS: z.enum(["BUSINESS"]).default("BUSINESS"),
  CURRENCY: z.string().default("USD"),

  DEPART_START: z.string().default("2026-12-10"),
  DEPART_END: z.string().default("2026-12-20"),
  RETURN_START: z.string().default("2027-01-01"),
  RETURN_END: z.string().default("2027-01-07"),
  TRIP_MIN_NIGHTS: z.coerce.number().int().min(1).default(7),
  TRIP_MAX_NIGHTS: z.coerce.number().int().min(1).default(21),

  ORIGINS: z.string().default("SEA,YVR"),
  DESTINATIONS_INCLUDE: z.string().optional(),
  DESTINATIONS_LIMIT: z.coerce.number().int().min(1).optional(),

  MAX_STOPS_TOTAL: z.coerce.number().int().min(0).default(1),
  OVERNIGHT_MIN_HOURS: z.coerce.number().int().min(1).default(8),

  SCAN_MAX_COMBOS: z.coerce.number().int().min(1).default(250),
  SCAN_MAX_OFFERS_PER_QUERY: z.coerce.number().int().min(1).default(20),
  SCAN_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),

  AMADEUS_HOST: z.string().default("https://test.api.amadeus.com"),
  AMADEUS_CLIENT_ID: z.string().optional(),
  AMADEUS_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function env(): Env {
  if (_env) return _env;
  _env = EnvSchema.parse(process.env);
  return _env;
}
