import { describe, expect, it } from "vitest";
import { generateDatePairs, tripNights } from "@/lib/searchSpace/datePairs";

describe("generateDatePairs", () => {
  it("generates date pairs within windows and respects min/max nights", () => {
    const pairs = generateDatePairs({
      departStart: "2026-12-10",
      departEnd: "2026-12-12",
      returnStart: "2026-12-20",
      returnEnd: "2026-12-25",
      minNights: 7,
      maxNights: 21,
    });

    expect(pairs.length).toBe(18);

    for (const p of pairs) {
      expect(p.departDate >= "2026-12-10" && p.departDate <= "2026-12-12").toBe(true);
      expect(p.returnDate >= "2026-12-20" && p.returnDate <= "2026-12-25").toBe(true);

      const nights = tripNights(p.departDate, p.returnDate);
      expect(nights).toBe(p.nights);
      expect(nights).toBeGreaterThanOrEqual(7);
      expect(nights).toBeLessThanOrEqual(21);
    }
  });
});
