import { AttendanceSource } from "@prisma/client";

export type BrivoAuthToken = {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
};

export type BrivoUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  raw: unknown;
};

export type BrivoSite = {
  id: string;
  name: string;
  timezone?: string | null;
  raw: unknown;
};

export type BrivoAccessEvent = {
  id: string;
  occurredAt: string;
  brivoUserId: string | null;
  brivoDoorId: string | null;
  eventType: string | null;
  securityAction: string | null;
  payload: unknown;
  ingestionMode: AttendanceSource;
};

export type BrivoEventPage = {
  events: BrivoAccessEvent[];
  nextCursor: string | null;
};

export type BrivoEventQuery = {
  from: string;
  to: string;
  cursor?: string | null;
  pageSize?: number;
};

export type BrivoSubscriptionInput = {
  callbackUrl: string;
  secret?: string;
};

export type BrivoSubscriptionResult = {
  subscriptionId: string;
  status: string;
  raw: unknown;
};

export interface BrivoAdapter {
  mode: "mock" | "live";
  listUsers(): Promise<BrivoUser[]>;
  listSites(): Promise<BrivoSite[]>;
  listEvents(query: BrivoEventQuery): Promise<BrivoEventPage>;
  createOrRefreshEventSubscription(
    input: BrivoSubscriptionInput,
  ): Promise<BrivoSubscriptionResult>;
}
