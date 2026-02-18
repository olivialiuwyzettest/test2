import "server-only";
import { z } from "zod";

const schema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  databaseUrl: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/wyze_rto?schema=public"),
  appSharedAccessCode: z.string().min(1).default("wyze-rto-internal"),
  appAllowedEmailDomains: z.string().default("wyze.com"),
  sessionSecret: z.string().min(16).default("dev-only-session-secret-change-me"),
  appDefaultTimezone: z.string().default("America/Los_Angeles"),
  appCronSecret: z.string().min(1).optional(),
  brivoMode: z.enum(["mock", "live"]).default("mock"),
  brivoAuthUrl: z.string().url().default("https://auth.brivo.com/oauth/token"),
  brivoApiBaseUrl: z.string().url().default("https://api.brivo.com/v1/api"),
  brivoApiKeyHeader: z.string().default("api-key"),
  brivoApiKey: z.string().optional(),
  brivoClientId: z.string().optional(),
  brivoClientSecret: z.string().optional(),
  brivoRefreshToken: z.string().optional(),
  brivoUsername: z.string().optional(),
  brivoPassword: z.string().optional(),
  brivoWebhookMode: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  brivoWebhookSecret: z.string().optional(),
  brivoEntryEventMarkers: z.string().default("OPEN,ACCESS_GRANTED,DOOR_OPEN,ACCESS-ALLOWED"),
  brivoAutoLinkByEmail: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

const parsed = schema.parse({
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: process.env.DATABASE_URL,
  appSharedAccessCode: process.env.APP_SHARED_ACCESS_CODE,
  appAllowedEmailDomains: process.env.APP_ALLOWED_EMAIL_DOMAINS,
  sessionSecret: process.env.APP_SESSION_SECRET,
  appDefaultTimezone: process.env.APP_DEFAULT_TIMEZONE,
  appCronSecret: process.env.APP_CRON_SECRET,
  brivoMode: process.env.BRIVO_MODE,
  brivoAuthUrl: process.env.BRIVO_AUTH_URL,
  brivoApiBaseUrl: process.env.BRIVO_API_BASE_URL,
  brivoApiKeyHeader: process.env.BRIVO_API_KEY_HEADER,
  brivoApiKey: process.env.BRIVO_API_KEY,
  brivoClientId: process.env.BRIVO_CLIENT_ID,
  brivoClientSecret: process.env.BRIVO_CLIENT_SECRET,
  brivoRefreshToken: process.env.BRIVO_REFRESH_TOKEN,
  brivoUsername: process.env.BRIVO_USERNAME,
  brivoPassword: process.env.BRIVO_PASSWORD,
  brivoWebhookMode: process.env.BRIVO_WEBHOOK_MODE,
  brivoWebhookSecret: process.env.BRIVO_WEBHOOK_SECRET,
  brivoEntryEventMarkers: process.env.BRIVO_ENTRY_EVENT_MARKERS,
  brivoAutoLinkByEmail: process.env.BRIVO_AUTO_LINK_BY_EMAIL,
});

export const env = {
  ...parsed,
  allowedEmailDomains: parsed.appAllowedEmailDomains
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean),
  entryEventMarkers: parsed.brivoEntryEventMarkers
    .split(",")
    .map((marker) => marker.trim().toUpperCase())
    .filter(Boolean),
};
