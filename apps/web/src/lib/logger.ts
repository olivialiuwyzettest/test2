const REDACT_KEYS = new Set([
  "access_token",
  "authorization",
  "client_secret",
  "clientSecret",
  "AMADEUS_CLIENT_SECRET",
  "token",
]);

function redactValue(key: string, value: unknown): unknown {
  if (REDACT_KEYS.has(key)) return "[REDACTED]";
  return value;
}

function safeStringify(meta: unknown): string {
  try {
    return JSON.stringify(meta, (k, v) => redactValue(k, v));
  } catch {
    return "[unserializable]";
  }
}

export const logger = {
  info(message: string, meta?: unknown) {
    console.log(`[info] ${message}${meta ? ` ${safeStringify(meta)}` : ""}`);
  },
  warn(message: string, meta?: unknown) {
    console.warn(`[warn] ${message}${meta ? ` ${safeStringify(meta)}` : ""}`);
  },
  error(message: string, meta?: unknown) {
    console.error(`[error] ${message}${meta ? ` ${safeStringify(meta)}` : ""}`);
  },
};
