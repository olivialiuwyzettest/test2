import { PrismaClient } from "@prisma/client";
import { defaultTripConfig } from "@/lib/config/tripConfig";
import { runScanNow } from "@/lib/scanner/runScan";

async function main() {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.offer.count();
    if (existing > 0) {
      console.log(`Seed skipped (offers already exist: ${existing}).`);
      return;
    }

    const base = defaultTripConfig();
    const seedConfig = {
      ...base,
      // Keep seed fast but non-trivial so scoring has comparables.
      destinations: base.destinations.slice(0, 18),
      scan: { ...base.scan, maxCombos: 180, concurrency: Math.min(3, base.scan.concurrency) },
    };

    await runScanNow(prisma, { providerId: "mock", configOverride: seedConfig });
    console.log("Seed complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
