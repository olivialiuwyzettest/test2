import { AttendanceSource, EmployeeStatus, Prisma } from "@prisma/client";
import { addDays, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { env } from "@/lib/env";
import { getBrivoAdapter } from "@/lib/brivo";
import type { BrivoAccessEvent } from "@/lib/brivo/types";
import { db } from "@/lib/server/db";

type SyncWindow = {
  from?: Date;
  to?: Date;
};

type SyncSummary = {
  mode: "mock" | "live";
  fetchedEvents: number;
  insertedRawEvents: number;
  attendanceDaysTouched: number;
  from: string;
  to: string;
};

async function sleep(milliseconds: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(250 * (attempt + 1) ** 2);
      }
    }
  }
  throw lastError;
}

function normalizeMarker(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function isQualifyingEntryEvent(event: { eventType?: string | null; securityAction?: string | null }): boolean {
  const candidates = [normalizeMarker(event.eventType), normalizeMarker(event.securityAction)];
  return candidates.some((candidate) => env.entryEventMarkers.includes(candidate));
}

function dateKeyInTimezone(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function parseWebhookEvents(payload: unknown): BrivoAccessEvent[] {
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const eventCandidates = Array.isArray(record.events)
    ? (record.events as unknown[])
    : Array.isArray(record.data)
      ? (record.data as unknown[])
      : [record];

  const events: BrivoAccessEvent[] = [];
  for (const candidate of eventCandidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const entry = candidate as Record<string, unknown>;
    const id =
      (entry.id as string | undefined) ??
      (entry.eventId as string | undefined) ??
      (entry.uuid as string | undefined) ??
      null;

    const occurredAt =
      (entry.occurredAt as string | undefined) ??
      (entry.occurred_at as string | undefined) ??
      (entry.timestamp as string | undefined) ??
      null;

    if (!id || !occurredAt) {
      continue;
    }

    const user = typeof entry.user === "object" && entry.user !== null
      ? (entry.user as Record<string, unknown>)
      : {};

    const door = typeof entry.door === "object" && entry.door !== null
      ? (entry.door as Record<string, unknown>)
      : {};

    events.push({
      id,
      occurredAt,
      brivoUserId:
        (entry.brivoUserId as string | undefined) ??
        (entry.userId as string | undefined) ??
        (user.id as string | undefined) ??
        null,
      brivoDoorId:
        (entry.brivoDoorId as string | undefined) ??
        (entry.doorId as string | undefined) ??
        (door.id as string | undefined) ??
        null,
      eventType:
        (entry.eventType as string | undefined) ??
        (entry.type as string | undefined) ??
        null,
      securityAction:
        (entry.securityAction as string | undefined) ??
        (entry.action as string | undefined) ??
        null,
      payload: candidate,
      ingestionMode: AttendanceSource.WEBHOOK,
    });
  }

  return events;
}

async function insertRawEvents(events: BrivoAccessEvent[]): Promise<number> {
  if (!events.length) {
    return 0;
  }

  const result = await db.brivoEventRaw.createMany({
    data: events.map((event) => ({
      brivoEventId: event.id,
      occurredAt: new Date(event.occurredAt),
      brivoUserId: event.brivoUserId,
      brivoDoorId: event.brivoDoorId,
      eventType: event.eventType,
      securityAction: event.securityAction,
      payloadJson: event.payload as Prisma.InputJsonValue,
      ingestionMode: event.ingestionMode,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

async function autoLinkBrivoUsersByEmail(): Promise<number> {
  if (!env.brivoAutoLinkByEmail) {
    return 0;
  }

  const adapter = getBrivoAdapter();
  const users = await adapter.listUsers();
  let updated = 0;

  for (const user of users) {
    if (!user.email) {
      continue;
    }

    const result = await db.employee.updateMany({
      where: {
        email: user.email.trim().toLowerCase(),
        OR: [{ brivoUserId: null }, { brivoUserId: user.id }],
      },
      data: {
        brivoUserId: user.id,
      },
    });
    updated += result.count;
  }

  return updated;
}

export async function rebuildAttendanceDaysFromRaw(window: SyncWindow): Promise<number> {
  const start = window.from ?? subDays(new Date(), 1);
  const end = window.to ?? new Date();

  const [rawEvents, doors] = await Promise.all([
    db.brivoEventRaw.findMany({
      where: {
        occurredAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { occurredAt: "asc" },
    }),
    db.door.findMany({
      include: {
        officeLocation: {
          select: {
            id: true,
            timezone: true,
          },
        },
      },
    }),
  ]);

  if (!rawEvents.length) {
    return 0;
  }

  const doorByBrivoId = new Map(
    doors
      .filter((door) => Boolean(door.brivoDoorId))
      .map((door) => [door.brivoDoorId as string, door]),
  );

  const brivoUserIds = Array.from(
    new Set(rawEvents.map((event) => event.brivoUserId).filter((value): value is string => Boolean(value))),
  );

  const employees = await db.employee.findMany({
    where: {
      brivoUserId: { in: brivoUserIds },
      status: EmployeeStatus.ACTIVE,
    },
    select: {
      id: true,
      brivoUserId: true,
    },
  });

  const employeeByBrivoUserId = new Map(
    employees
      .filter((employee) => Boolean(employee.brivoUserId))
      .map((employee) => [employee.brivoUserId as string, employee.id]),
  );

  const dailyMap = new Map<
    string,
    {
      employeeId: string;
      dateKey: string;
      firstSeenAt: Date;
      lastSeenAt: Date;
      officeLocationId: string | null;
      source: AttendanceSource;
    }
  >();

  for (const event of rawEvents) {
    if (!event.brivoUserId || !event.brivoDoorId) {
      continue;
    }

    const employeeId = employeeByBrivoUserId.get(event.brivoUserId);
    if (!employeeId) {
      continue;
    }

    const door = doorByBrivoId.get(event.brivoDoorId);
    if (!door || !door.countsForEntry) {
      continue;
    }

    if (!isQualifyingEntryEvent(event)) {
      continue;
    }

    const timezone = door.officeLocation?.timezone ?? env.appDefaultTimezone;
    const dateKey = dateKeyInTimezone(event.occurredAt, timezone);
    const key = `${employeeId}:${dateKey}`;

    const existing = dailyMap.get(key);
    if (!existing) {
      dailyMap.set(key, {
        employeeId,
        dateKey,
        firstSeenAt: event.occurredAt,
        lastSeenAt: event.occurredAt,
        officeLocationId: door.officeLocationId,
        source: event.ingestionMode,
      });
      continue;
    }

    if (event.occurredAt < existing.firstSeenAt) {
      existing.firstSeenAt = event.occurredAt;
    }
    if (event.occurredAt > existing.lastSeenAt) {
      existing.lastSeenAt = event.occurredAt;
    }

    // Prefer webhook source when both exist.
    if (event.ingestionMode === AttendanceSource.WEBHOOK) {
      existing.source = AttendanceSource.WEBHOOK;
    }
  }

  const operations: Array<Prisma.PrismaPromise<unknown>> = [];
  for (const record of dailyMap.values()) {
    const dayDate = new Date(`${record.dateKey}T00:00:00.000Z`);
    operations.push(
      db.attendanceDay.upsert({
        where: {
          employeeId_date: {
            employeeId: record.employeeId,
            date: dayDate,
          },
        },
        update: {
          firstSeenAt: record.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          present: true,
          officeLocationId: record.officeLocationId,
          source: record.source,
        },
        create: {
          employeeId: record.employeeId,
          date: dayDate,
          firstSeenAt: record.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          present: true,
          officeLocationId: record.officeLocationId,
          source: record.source,
        },
      }),
    );
  }

  if (!operations.length) {
    return 0;
  }

  await db.$transaction(operations);
  return operations.length;
}

export async function runPollingSync(window: SyncWindow = {}): Promise<SyncSummary> {
  const adapter = getBrivoAdapter();

  const cursor = await db.ingestionCursor.findUnique({ where: { id: "default" } });
  const start = window.from ?? cursor?.lastOccurredAt ?? subDays(new Date(), 1);
  const end = window.to ?? new Date();

  let nextCursor: string | null = null;
  let fetchedEvents = 0;
  let insertedRawEvents = 0;

  do {
    const page = await withRetry(() =>
      adapter.listEvents({
        from: start.toISOString(),
        to: end.toISOString(),
        cursor: nextCursor,
        pageSize: 500,
      }),
    );

    fetchedEvents += page.events.length;
    insertedRawEvents += await insertRawEvents(
      page.events.map((event) => ({
        ...event,
        ingestionMode: AttendanceSource.POLLING,
      })),
    );

    nextCursor = page.nextCursor;
  } while (nextCursor);

  await autoLinkBrivoUsersByEmail();

  const attendanceDaysTouched = await rebuildAttendanceDaysFromRaw({ from: start, to: end });

  await db.ingestionCursor.upsert({
    where: { id: "default" },
    update: {
      lastOccurredAt: end,
      lastBrivoEventId: `cursor-${end.toISOString()}`,
    },
    create: {
      id: "default",
      lastOccurredAt: end,
      lastBrivoEventId: `cursor-${end.toISOString()}`,
    },
  });

  return {
    mode: adapter.mode,
    fetchedEvents,
    insertedRawEvents,
    attendanceDaysTouched,
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

export async function ingestWebhookPayload(payload: unknown): Promise<{
  receivedEvents: number;
  insertedRawEvents: number;
  attendanceDaysTouched: number;
}> {
  const events = parseWebhookEvents(payload).map((event) => ({
    ...event,
    ingestionMode: AttendanceSource.WEBHOOK,
  }));

  if (!events.length) {
    return {
      receivedEvents: 0,
      insertedRawEvents: 0,
      attendanceDaysTouched: 0,
    };
  }

  const insertedRawEvents = await insertRawEvents(events);

  const occurredDates = events.map((event) => new Date(event.occurredAt));
  const from = occurredDates.reduce((earliest, candidate) =>
    candidate < earliest ? candidate : earliest,
  );
  const to = addDays(
    occurredDates.reduce((latest, candidate) => (candidate > latest ? candidate : latest)),
    1,
  );

  const attendanceDaysTouched = await rebuildAttendanceDaysFromRaw({ from, to });

  return {
    receivedEvents: events.length,
    insertedRawEvents,
    attendanceDaysTouched,
  };
}

export async function createOrRefreshBrivoSubscription(input: {
  callbackUrl: string;
  secret?: string;
}) {
  const adapter = getBrivoAdapter();
  const result = await adapter.createOrRefreshEventSubscription({
    callbackUrl: input.callbackUrl,
    secret: input.secret,
  });

  const payload = {
    subscriptionId: result.subscriptionId,
    status: result.status,
    callbackUrl: input.callbackUrl,
    refreshedAt: new Date().toISOString(),
    raw: jsonValue(result.raw),
  } as Prisma.InputJsonValue;

  await db.appSetting.upsert({
    where: { key: "brivo_event_subscription" },
    update: {
      valueJson: payload,
    },
    create: {
      key: "brivo_event_subscription",
      valueJson: payload,
    },
  });

  return result;
}

export async function reconcileRecentAttendance(): Promise<number> {
  const now = new Date();
  const start = subDays(now, 2);
  return rebuildAttendanceDaysFromRaw({ from: start, to: now });
}
