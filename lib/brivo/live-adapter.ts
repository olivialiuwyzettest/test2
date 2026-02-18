import { AttendanceSource } from "@prisma/client";
import { env } from "@/lib/env";
import {
  BrivoAdapter,
  BrivoAccessEvent,
  BrivoAuthToken,
  BrivoEventPage,
  BrivoEventQuery,
  BrivoSite,
  BrivoSubscriptionInput,
  BrivoSubscriptionResult,
  BrivoUser,
} from "@/lib/brivo/types";

type AnyRecord = Record<string, unknown>;

type TokenCache = {
  token: BrivoAuthToken;
  expiresAt: number;
};

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function pickString(record: AnyRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function pickArray(record: AnyRecord, keys: string[]): unknown[] {
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function bearer(value: string): string {
  return value.startsWith("Bearer ") ? value : `Bearer ${value}`;
}

function toBrivoEvent(value: unknown): BrivoAccessEvent | null {
  const record = asRecord(value);
  const user = asRecord(record.user ?? record.person ?? record.identity);
  const door = asRecord(record.door ?? record.device ?? record.portal);

  const id = pickString(record, ["id", "eventId", "event_id", "uuid"]);
  const occurredAt = pickString(record, [
    "occurredAt",
    "occurred_at",
    "occurred",
    "timestamp",
    "createdAt",
  ]);

  if (!id || !occurredAt) {
    return null;
  }

  return {
    id,
    occurredAt,
    brivoUserId:
      pickString(record, ["userId", "personId", "memberId", "brivoUserId"]) ??
      pickString(user, ["id", "userId", "personId"]),
    brivoDoorId:
      pickString(record, ["doorId", "deviceId", "portalId", "brivoDoorId"]) ??
      pickString(door, ["id", "doorId", "deviceId"]),
    eventType: pickString(record, ["eventType", "type", "event_name", "name"]),
    securityAction: pickString(record, ["securityAction", "action", "result", "status"]),
    payload: value,
    ingestionMode: AttendanceSource.POLLING,
  };
}

function toBrivoUser(value: unknown): BrivoUser | null {
  const record = asRecord(value);
  const id = pickString(record, ["id", "userId", "personId", "uuid"]);
  if (!id) return null;

  return {
    id,
    email: pickString(record, ["email", "emailAddress", "workEmail"]),
    name: pickString(record, ["name", "displayName", "fullName"]),
    raw: value,
  };
}

function toBrivoSite(value: unknown): BrivoSite | null {
  const record = asRecord(value);
  const id = pickString(record, ["id", "siteId", "uuid"]);
  const name = pickString(record, ["name", "siteName", "displayName"]);
  if (!id || !name) return null;

  return {
    id,
    name,
    timezone: pickString(record, ["timezone", "timeZone", "tz"]),
    raw: value,
  };
}

export class BrivoLiveAdapter implements BrivoAdapter {
  readonly mode = "live" as const;
  private tokenCache: TokenCache | null = null;

  private async getAuthToken(): Promise<BrivoAuthToken> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    if (!env.brivoClientId || !env.brivoClientSecret) {
      throw new Error("Brivo live mode requires BRIVO_CLIENT_ID and BRIVO_CLIENT_SECRET.");
    }

    const basicAuth = Buffer.from(`${env.brivoClientId}:${env.brivoClientSecret}`).toString("base64");
    const params = new URLSearchParams();

    if (env.brivoRefreshToken) {
      params.set("grant_type", "refresh_token");
      params.set("refresh_token", env.brivoRefreshToken);
    } else if (env.brivoUsername && env.brivoPassword) {
      // Password grant for server-to-server Brivo setups.
      params.set("grant_type", "password");
      params.set("username", env.brivoUsername);
      params.set("password", env.brivoPassword);
    } else {
      // Fallback for tenants that support client credentials.
      params.set("grant_type", "client_credentials");
    }

    const tokenHeaders: Record<string, string> = {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (env.brivoApiKey) {
      tokenHeaders[env.brivoApiKeyHeader] = env.brivoApiKey;
    }

    let response = await fetch(env.brivoAuthUrl, {
      method: "POST",
      headers: tokenHeaders,
      body: params.toString(),
    });

    if (!response.ok) {
      // Some Brivo tenant configs require query-style token requests.
      const queryStyleUrl = `${env.brivoAuthUrl}?${params.toString()}`;
      const queryHeaders: Record<string, string> = {
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      };
      if (env.brivoApiKey) {
        queryHeaders[env.brivoApiKeyHeader] = env.brivoApiKey;
      }
      response = await fetch(queryStyleUrl, {
        method: "POST",
        headers: queryHeaders,
      });
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Brivo token request failed (${response.status}): ${body}`);
    }

    const payload = asRecord(await response.json());
    const accessToken = pickString(payload, ["access_token", "accessToken"]);
    const tokenType = pickString(payload, ["token_type", "tokenType"]) ?? "Bearer";
    const expiresIn = Number(pickString(payload, ["expires_in", "expiresIn"]) ?? "3600");

    if (!accessToken) {
      throw new Error("Brivo token response did not include an access token.");
    }

    const token: BrivoAuthToken = {
      accessToken,
      tokenType,
      expiresInSeconds: Number.isFinite(expiresIn) ? expiresIn : 3600,
    };

    this.tokenCache = {
      token,
      expiresAt: Date.now() + Math.max(60, token.expiresInSeconds - 60) * 1000,
    };

    return token;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    if (!env.brivoApiKey) {
      throw new Error("Brivo live mode requires BRIVO_API_KEY.");
    }

    const token = await this.getAuthToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", bearer(token.accessToken));
    headers.set(env.brivoApiKeyHeader, env.brivoApiKey);
    headers.set("Accept", "application/json");

    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${env.brivoApiBaseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Brivo API request failed (${response.status}) ${path}: ${body}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  async listUsers(): Promise<BrivoUser[]> {
    const response = asRecord(await this.request("/users"));
    const usersRaw = pickArray(response, ["data", "users", "items", "results"]);
    return usersRaw.map(toBrivoUser).filter((user): user is BrivoUser => Boolean(user));
  }

  async listSites(): Promise<BrivoSite[]> {
    const response = asRecord(await this.request("/sites"));
    const sitesRaw = pickArray(response, ["data", "sites", "items", "results"]);
    return sitesRaw.map(toBrivoSite).filter((site): site is BrivoSite => Boolean(site));
  }

  async listEvents(query: BrivoEventQuery): Promise<BrivoEventPage> {
    const searchParams = new URLSearchParams();

    // TODO: validate final query parameter names with production Brivo credentials.
    searchParams.set("start", query.from);
    searchParams.set("end", query.to);
    searchParams.set("from", query.from);
    searchParams.set("to", query.to);

    if (query.cursor) {
      searchParams.set("cursor", query.cursor);
    }

    if (query.pageSize) {
      searchParams.set("pageSize", String(query.pageSize));
      searchParams.set("limit", String(query.pageSize));
    }

    const response = asRecord(await this.request(`/events?${searchParams.toString()}`));
    const eventsRaw = pickArray(response, ["data", "events", "items", "results"]);
    const events = eventsRaw.map(toBrivoEvent).filter((event): event is BrivoAccessEvent => Boolean(event));

    const cursor =
      pickString(response, ["nextCursor", "next_cursor"]) ??
      pickString(asRecord(response.paging), ["nextCursor", "next"]);

    return {
      events,
      nextCursor: cursor,
    };
  }

  async createOrRefreshEventSubscription(
    input: BrivoSubscriptionInput,
  ): Promise<BrivoSubscriptionResult> {
    const payload = {
      callbackUrl: input.callbackUrl,
      // TODO: confirm exact webhook schema required by Brivo /event-subscriptions.
      endpoint: input.callbackUrl,
      sharedSecret: input.secret,
      secret: input.secret,
      eventTypes: ["access"],
    };

    const response = asRecord(
      await this.request("/event-subscriptions", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );

    return {
      subscriptionId:
        pickString(response, ["id", "subscriptionId", "uuid"]) ??
        `unknown-${Date.now()}`,
      status: pickString(response, ["status", "state"]) ?? "UNKNOWN",
      raw: response,
    };
  }
}
