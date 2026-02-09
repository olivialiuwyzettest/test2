import { describe, expect, it } from "vitest";
import { computeDealMetrics } from "@/lib/scoring/dealScore";

describe("computeDealMetrics", () => {
  it("flags a great deal when price is <= 15th percentile", () => {
    const comparable = Array.from({ length: 10 }, (_, i) => ({
      priceTotalCents: 1_000_000 + i * 100_000,
      totalTripMinutes: 1200 + i * 10,
    }));

    const m = computeDealMetrics({
      offer: {
        origin: "SEA",
        destination: "ICN",
        cabin: "BUSINESS",
        stopsCategory: "NONSTOP",
        stopsTotal: 0,
        priceTotalCents: 1_100_000,
        currency: "USD",
        totalTripMinutes: 1200,
      },
      comparable,
      priceHistory7d: [
        { priceTotalCents: 1_150_000, capturedAt: new Date("2026-02-01T00:00:00Z") },
        { priceTotalCents: 1_100_000, capturedAt: new Date("2026-02-08T00:00:00Z") },
      ],
    });

    expect(m.isGreatDeal).toBe(true);
    expect(m.dealScore).toBeGreaterThanOrEqual(80);
    expect(m.rationale.join(" ")).toMatch(/percentile/i);
  });

  it("flags a great deal when price dropped >= 10% in 7 days", () => {
    const comparable = Array.from({ length: 10 }, (_, i) => ({
      priceTotalCents: 1_000_000 + i * 100_000,
      totalTripMinutes: 1400,
    }));

    const m = computeDealMetrics({
      offer: {
        origin: "SEA",
        destination: "SIN",
        cabin: "BUSINESS",
        stopsCategory: "ONE_STOP_OVERNIGHT",
        stopsTotal: 1,
        priceTotalCents: 1_600_000,
        currency: "USD",
        totalTripMinutes: 1800,
      },
      comparable,
      priceHistory7d: [
        { priceTotalCents: 2_000_000, capturedAt: new Date("2026-02-01T00:00:00Z") },
        { priceTotalCents: 1_600_000, capturedAt: new Date("2026-02-08T00:00:00Z") },
      ],
    });

    expect(m.priceDrop7dPct).toBeGreaterThanOrEqual(0.1);
    expect(m.isGreatDeal).toBe(true);
  });
});

