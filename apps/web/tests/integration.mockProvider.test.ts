import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { defaultTripConfig } from "@/lib/config/tripConfig";
import { runScanNow } from "@/lib/scanner/runScan";
import { getDashboardData } from "@/lib/ui/dashboardData";

describe("integration: MockProvider scan -> DB -> dashboard query", () => {
  it("populates DB and produces dashboard data", async () => {
    const tmp = path.join(os.tmpdir(), `flight-deals-test-${Date.now()}`);
    const dbPath = path.join(tmp, "test.db");
    process.env.DATABASE_URL = `file:${dbPath}`;

    // Ensure schema exists for this DATABASE_URL.
    execSync("mkdir -p " + JSON.stringify(tmp));
    execSync("touch " + JSON.stringify(dbPath));
    execSync("npx prisma db push --skip-generate", {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      stdio: "inherit",
    });

    const prisma = new PrismaClient();
    try {
      const base = defaultTripConfig();
      const cfg = {
        ...base,
        destinations: ["HND", "ICN", "SIN", "HKG", "TPE"],
        scan: { ...base.scan, maxCombos: 60, concurrency: 1, maxOffersPerQuery: 5 },
      };

      const result = await runScanNow(prisma, { providerId: "mock", configOverride: cfg });
      expect(["SUCCESS", "PARTIAL"]).toContain(result.status);

      const dashboard = await getDashboardData(prisma, {});
      expect(dashboard.offers.length).toBeGreaterThan(0);
      expect(dashboard.topDeals.length).toBeLessThanOrEqual(3);
      expect(dashboard.offers.some((o) => typeof o.dealScore === "number")).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  }, 60_000);
});
