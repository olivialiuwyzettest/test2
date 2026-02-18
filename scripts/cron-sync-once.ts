import { subDays } from "date-fns";
import { reconcileRecentAttendance, runPollingSync } from "@/lib/attendance/ingestion";

async function main() {
  const now = new Date();
  const summary = await runPollingSync({ from: subDays(now, 1), to: now });
  const reconciled = await reconcileRecentAttendance();

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary,
        reconciled,
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
