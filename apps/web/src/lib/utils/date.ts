import { DateTime } from "luxon";

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseIsoDate(date: string): DateTime {
  if (!isIsoDate(date)) throw new Error(`Invalid ISO date (YYYY-MM-DD): ${date}`);
  const dt = DateTime.fromISO(date, { zone: "utc" });
  if (!dt.isValid) throw new Error(`Invalid ISO date (YYYY-MM-DD): ${date}`);
  return dt.startOf("day");
}

export function diffDays(startDate: string, endDate: string): number {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  return Math.round(end.diff(start, "days").days);
}

export function addDays(date: string, days: number): string {
  return parseIsoDate(date).plus({ days }).toISODate()!;
}

export function listDatesInRangeInclusive(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (end < start) return [];

  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur.toISODate()!);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

export function todayIsoUtc(): string {
  return DateTime.utc().toISODate()!;
}

export function daysFromTodayUtc(date: string): number {
  const today = parseIsoDate(todayIsoUtc());
  const target = parseIsoDate(date);
  return Math.round(target.diff(today, "days").days);
}

