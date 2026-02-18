import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/guards";
import { getWeeklyRowsForExport } from "@/lib/attendance/compliance";
import { toCsv } from "@/lib/attendance/importers";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const weekStart = url.searchParams.get("week");
  const teamId = url.searchParams.get("teamId");
  const locationId = url.searchParams.get("locationId");

  const managerEmployeeId = user.role === Role.MANAGER ? user.employeeId : null;
  if (user.role === Role.MANAGER && !managerEmployeeId) {
    return NextResponse.json({ error: "Manager account is not linked to an employee record." }, { status: 403 });
  }

  if (![Role.ADMIN, Role.LEADER, Role.MANAGER].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await getWeeklyRowsForExport({
    weekStart,
    teamId,
    locationId,
    managerEmployeeId,
  });

  const csv = toCsv(
    result.rows.map((row) => ({
      weekStart: result.weekStart,
      team: row.teamName,
      employeeName: row.name,
      employeeEmail: row.email,
      actualDays: row.actualDays,
      requiredDaysAdjusted: row.requiredDaysAdjusted,
      deficit: row.deficit,
      policyCompliant: row.policyCompliant,
      scheduleAdherencePct: row.scheduleAdherencePct,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? "",
    })),
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rto-compliance-${result.weekStart}.csv"`,
    },
  });
}
