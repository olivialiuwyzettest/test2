import { NextResponse } from "next/server";
import { subDays } from "date-fns";
import { env } from "@/lib/env";
import { runPollingSync, reconcileRecentAttendance } from "@/lib/attendance/ingestion";

export async function GET(request: Request) {
  if (env.appCronSecret) {
    const providedSecret =
      request.headers.get("x-cron-secret") ??
      new URL(request.url).searchParams.get("secret");

    if (providedSecret !== env.appCronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const now = new Date();
    const summary = await runPollingSync({ from: subDays(now, 1), to: now });
    const reconciledDays = await reconcileRecentAttendance();

    return NextResponse.json({
      ok: true,
      summary,
      reconciledDays,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 },
    );
  }
}
