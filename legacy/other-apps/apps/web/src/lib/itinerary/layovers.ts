import { DateTime } from "luxon";
import type { Segment } from "@/lib/providers/types";

export type ConnectionLayover = {
  atAirport: string;
  minutes: number;
  isOvernight: boolean;
  arrivesLocal: string;
  departsLocal: string;
};

export type LayoverSummary = {
  stops: number;
  layovers: ConnectionLayover[];
  hasAnyOvernight: boolean;
};

function isoDatePart(ts: string): string {
  // Provider timestamps may be ISO without timezone. Date portion is still YYYY-MM-DD.
  return ts.slice(0, 10);
}

export function computeLayovers(segments: Segment[], overnightMinHours: number): LayoverSummary {
  if (segments.length <= 1) {
    return { stops: 0, layovers: [], hasAnyOvernight: false };
  }

  const layovers: ConnectionLayover[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const arrive = segments[i]!.arriveLocal;
    const depart = segments[i + 1]!.departLocal;
    const atAirport = segments[i]!.to;

    const arriveDt = DateTime.fromISO(arrive, { zone: "utc" });
    const departDt = DateTime.fromISO(depart, { zone: "utc" });
    const minutes = Math.max(0, Math.round(departDt.diff(arriveDt, "minutes").minutes));

    const crossesMidnight = isoDatePart(arrive) !== isoDatePart(depart);
    const isOvernight = minutes >= overnightMinHours * 60 && crossesMidnight;

    layovers.push({
      atAirport,
      minutes,
      isOvernight,
      arrivesLocal: arrive,
      departsLocal: depart,
    });
  }

  return { stops: segments.length - 1, layovers, hasAnyOvernight: layovers.some((l) => l.isOvernight) };
}

export function formatMinutesHuman(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "n/a";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

