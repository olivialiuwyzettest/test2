import { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { runScanNow } from "@/lib/scanner/runScan";

async function main() {
  const e = env();
  const prisma = new PrismaClient();

  let running = false;
  const run = async (reason: string) => {
    if (running) {
      logger.warn("Scan already running; skipping", { reason });
      return;
    }
    running = true;
    try {
      await runScanNow(prisma);
    } catch (err) {
      logger.error("Scheduled scan failed", { reason, error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };

  if (e.RUN_SCAN_ON_STARTUP) {
    void run("startup");
  }

  const task = cron.schedule(
    e.SCAN_CRON,
    () => {
      void run("cron");
    },
    { timezone: e.SCAN_TIMEZONE },
  );

  task.start();
  logger.info("Worker started", { cron: e.SCAN_CRON, timezone: e.SCAN_TIMEZONE });

  const shutdown = async (signal: string) => {
    logger.info("Worker shutting down", { signal });
    task.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
