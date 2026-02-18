import { AttendanceSource, EmployeeStatus, Weekday } from "@prisma/client";
import { addDays, isAfter, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/server/db";
import { env } from "@/lib/env";
import {
  BrivoAdapter,
  BrivoAccessEvent,
  BrivoEventPage,
  BrivoEventQuery,
  BrivoSite,
  BrivoSubscriptionInput,
  BrivoSubscriptionResult,
  BrivoUser,
} from "@/lib/brivo/types";

const WEEKDAY_BY_INDEX: Record<number, Weekday> = {
  0: Weekday.SUN,
  1: Weekday.MON,
  2: Weekday.TUE,
  3: Weekday.WED,
  4: Weekday.THU,
  5: Weekday.FRI,
  6: Weekday.SAT,
};

function stableHash(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) % 10000019;
  }
  return hash;
}

function shouldGenerateEntry(email: string, dateKey: string, scheduled: boolean): boolean {
  const threshold = scheduled ? 870 : 200;
  return stableHash(`${email}:${dateKey}:entry`) % 1000 < threshold;
}

function dateKeyInTimezone(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function createEventId(brivoUserId: string, dateKey: string): string {
  return `mock-${brivoUserId}-${dateKey}`;
}

function paginateEvents(
  events: BrivoAccessEvent[],
  cursor: string | null | undefined,
  pageSize: number,
): BrivoEventPage {
  const offset = cursor ? Number(Buffer.from(cursor, "base64url").toString("utf8")) : 0;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  const nextOffset = safeOffset + pageSize;

  return {
    events: events.slice(safeOffset, nextOffset),
    nextCursor: nextOffset < events.length ? Buffer.from(String(nextOffset)).toString("base64url") : null,
  };
}

export class BrivoMockAdapter implements BrivoAdapter {
  readonly mode = "mock" as const;

  async listUsers(): Promise<BrivoUser[]> {
    const employees = await db.employee.findMany({
      where: {
        status: EmployeeStatus.ACTIVE,
      },
      select: {
        brivoUserId: true,
        email: true,
        name: true,
      },
    });

    return employees
      .filter((employee) => Boolean(employee.brivoUserId))
      .map((employee) => ({
        id: employee.brivoUserId as string,
        email: employee.email,
        name: employee.name,
        raw: employee,
      }));
  }

  async listSites(): Promise<BrivoSite[]> {
    const locations = await db.officeLocation.findMany({
      select: {
        id: true,
        name: true,
        timezone: true,
        brivoSiteId: true,
      },
    });

    return locations.map((location) => ({
      id: location.brivoSiteId ?? location.id,
      name: location.name,
      timezone: location.timezone,
      raw: location,
    }));
  }

  async listEvents(query: BrivoEventQuery): Promise<BrivoEventPage> {
    const fromDate = parseISO(query.from);
    const toDate = parseISO(query.to);
    const pageSize = Math.min(query.pageSize ?? 500, 1000);

    const [employees, doors] = await Promise.all([
      db.employee.findMany({
        where: {
          status: EmployeeStatus.ACTIVE,
          brivoUserId: { not: null },
        },
        include: {
          team: {
            select: {
              scheduleDays: true,
            },
          },
          officeLocation: {
            select: {
              timezone: true,
            },
          },
        },
      }),
      db.door.findMany({
        where: { countsForEntry: true, brivoDoorId: { not: null } },
        select: { brivoDoorId: true },
      }),
    ]);

    const validDoors = doors
      .map((door) => door.brivoDoorId)
      .filter((doorId): doorId is string => Boolean(doorId));

    const events: BrivoAccessEvent[] = [];
    for (const employee of employees) {
      const timezone = employee.officeLocation?.timezone ?? env.appDefaultTimezone;
      for (let pointer = fromDate; !isAfter(pointer, toDate); pointer = addDays(pointer, 1)) {
        const dateKey = dateKeyInTimezone(pointer, timezone);
        const weekday = WEEKDAY_BY_INDEX[parseISO(`${dateKey}T00:00:00.000Z`).getUTCDay()];
        if (weekday === Weekday.SAT || weekday === Weekday.SUN) {
          continue;
        }

        const scheduled = employee.team.scheduleDays.includes(weekday);
        if (!shouldGenerateEntry(employee.email, dateKey, scheduled)) {
          continue;
        }

        const minuteOffset = stableHash(`${employee.email}:${dateKey}:minute`) % 45;
        const occurredAt = new Date(`${dateKey}T17:${String(minuteOffset).padStart(2, "0")}:00.000Z`);
        const doorId = validDoors.length
          ? validDoors[stableHash(`${employee.email}:${dateKey}:door`) % validDoors.length]
          : null;

        events.push({
          id: createEventId(employee.brivoUserId as string, dateKey),
          occurredAt: occurredAt.toISOString(),
          brivoUserId: employee.brivoUserId,
          brivoDoorId: doorId,
          eventType: "OPEN",
          securityAction: "ACCESS_GRANTED",
          payload: {
            mode: "mock",
            email: employee.email,
            teamId: employee.teamId,
            date: dateKey,
          },
          ingestionMode: AttendanceSource.POLLING,
        });
      }
    }

    events.sort((left, right) => {
      if (left.occurredAt !== right.occurredAt) {
        return left.occurredAt.localeCompare(right.occurredAt);
      }
      return left.id.localeCompare(right.id);
    });

    return paginateEvents(events, query.cursor, pageSize);
  }

  async createOrRefreshEventSubscription(
    input: BrivoSubscriptionInput,
  ): Promise<BrivoSubscriptionResult> {
    return {
      subscriptionId: `mock-sub-${stableHash(input.callbackUrl)}`,
      status: "ACTIVE",
      raw: {
        callbackUrl: input.callbackUrl,
        mode: "mock",
        refreshedAt: new Date().toISOString(),
      },
    };
  }
}
