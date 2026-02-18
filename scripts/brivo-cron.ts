import cron from "node-cron";
import { subDays } from "date-fns";
import { runPollingSync, reconcileRecentAttendance } from "@/lib/attendance/ingestion";

async function runDailySync() {
  const now = new Date();
  const summary = await runPollingSync({ from: subDays(now, 1), to: now });
  const reconciled = await reconcileRecentAttendance();

  console.log(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary,
        reconciled,
      },
      null,
      2,
    ),
  );
}

cron.schedule("0 5 * * *", () => {
  runDailySync().catch((error) => {
    console.error("Daily Brivo sync failed", error);
  });
});

console.log("Brivo cron runner started (5:00 daily). Ctrl+C to stop.");
runDailySync().catch((error) => {
  console.error("Initial Brivo sync failed", error);
});
