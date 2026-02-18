import { Weekday } from "@prisma/client";
import { addDays, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

const WEEKDAYS: Weekday[] = [
  Weekday.SUN,
  Weekday.MON,
  Weekday.TUE,
  Weekday.WED,
  Weekday.THU,
  Weekday.FRI,
  Weekday.SAT,
];

export function toDateKey(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

export function dateKeyToUtcDate(dateKey: string, timezone: string): Date {
  return fromZonedTime(`${dateKey}T00:00:00`, timezone);
}

export function weekdayForDate(date: Date, timezone: string): Weekday {
  const zoned = toZonedTime(date, timezone);
  return WEEKDAYS[zoned.getDay()];
}

export function mondayOfWeek(date: Date, timezone: string): string {
  const zoned = toZonedTime(date, timezone);
  const start = startOfWeek(zoned, { weekStartsOn: 1 });
  return formatInTimeZone(start, timezone, "yyyy-MM-dd");
}

export function weekdaysForWeek(mondayDateKey: string, timezone: string): string[] {
  const monday = dateKeyToUtcDate(mondayDateKey, timezone);
  return Array.from({ length: 5 }, (_, index) =>
    toDateKey(addDays(monday, index), timezone),
  );
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function parseIsoDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalized = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  return normalized;
}
