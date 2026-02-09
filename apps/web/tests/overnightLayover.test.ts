import { describe, expect, it } from "vitest";
import { computeLayovers } from "@/lib/itinerary/layovers";

describe("computeLayovers", () => {
  it("detects an overnight layover (>= 8h and crosses midnight)", () => {
    const segments = [
      {
        carrierCode: "MO",
        flightNumber: "123",
        from: "SEA",
        to: "HNL",
        departLocal: "2026-12-10T16:00:00",
        arriveLocal: "2026-12-10T23:00:00",
      },
      {
        carrierCode: "MO",
        flightNumber: "456",
        from: "HNL",
        to: "HND",
        departLocal: "2026-12-11T07:30:00",
        arriveLocal: "2026-12-11T12:00:00",
      },
    ];

    const info = computeLayovers(segments, 8);
    expect(info.stops).toBe(1);
    expect(info.layovers[0]?.minutes).toBeGreaterThanOrEqual(8 * 60);
    expect(info.layovers[0]?.isOvernight).toBe(true);
    expect(info.hasAnyOvernight).toBe(true);
  });

  it("does not mark long same-day layover as overnight if it does not cross midnight", () => {
    const segments = [
      {
        carrierCode: "MO",
        flightNumber: "1",
        from: "SEA",
        to: "HNL",
        departLocal: "2026-12-10T08:00:00",
        arriveLocal: "2026-12-10T10:00:00",
      },
      {
        carrierCode: "MO",
        flightNumber: "2",
        from: "HNL",
        to: "HND",
        departLocal: "2026-12-10T19:30:00", // 9.5h but same date
        arriveLocal: "2026-12-11T02:00:00",
      },
    ];

    const info = computeLayovers(segments, 8);
    expect(info.layovers[0]?.minutes).toBeGreaterThanOrEqual(8 * 60);
    expect(info.layovers[0]?.isOvernight).toBe(false);
    expect(info.hasAnyOvernight).toBe(false);
  });

  it("does not mark cross-midnight layover as overnight if shorter than minimum", () => {
    const segments = [
      {
        carrierCode: "MO",
        flightNumber: "1",
        from: "SEA",
        to: "HNL",
        departLocal: "2026-12-10T21:00:00",
        arriveLocal: "2026-12-10T23:30:00",
      },
      {
        carrierCode: "MO",
        flightNumber: "2",
        from: "HNL",
        to: "HND",
        departLocal: "2026-12-11T04:30:00", // 5h
        arriveLocal: "2026-12-11T09:00:00",
      },
    ];

    const info = computeLayovers(segments, 8);
    expect(info.layovers[0]?.isOvernight).toBe(false);
    expect(info.hasAnyOvernight).toBe(false);
  });
});

