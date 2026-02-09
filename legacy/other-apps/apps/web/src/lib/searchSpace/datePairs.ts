import { diffDays, listDatesInRangeInclusive } from "@/lib/utils/date";

export type DatePair = {
  departDate: string;
  returnDate: string;
  nights: number;
};

export function generateDatePairs(params: {
  departStart: string;
  departEnd: string;
  returnStart: string;
  returnEnd: string;
  minNights: number;
  maxNights: number;
}): DatePair[] {
  const departDates = listDatesInRangeInclusive(params.departStart, params.departEnd);
  const returnDates = new Set(listDatesInRangeInclusive(params.returnStart, params.returnEnd));

  const out: DatePair[] = [];
  for (const departDate of departDates) {
    for (let nights = params.minNights; nights <= params.maxNights; nights += 1) {
      const returnDate = addDaysLocal(departDate, nights);
      if (!returnDates.has(returnDate)) continue;
      out.push({ departDate, returnDate, nights });
    }
  }

  // Stable ordering: earliest depart, then earliest return.
  out.sort((a, b) => (a.departDate === b.departDate ? a.returnDate.localeCompare(b.returnDate) : a.departDate.localeCompare(b.departDate)));
  return out;
}

function addDaysLocal(date: string, days: number): string {
  // depart/return are pure dates, so adding days is safe using diffDays-based helper.
  // Avoid importing more helpers to keep this module small.
  const dummyEnd = date; // no-op, just to reuse existing helper shape if needed
  void dummyEnd;
  // Use diffDays trick? No. Implement directly using JS Date in UTC (safe for YYYY-MM-DD).
  const [y, m, d] = date.split("-").map((v) => Number(v));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function tripNights(departDate: string, returnDate: string): number {
  return diffDays(departDate, returnDate);
}

