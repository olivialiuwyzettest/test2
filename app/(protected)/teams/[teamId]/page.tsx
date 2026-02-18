import Link from "next/link";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import {
  getReportingTreeIds,
  getTeamDetailData,
} from "@/lib/attendance/compliance";
import { requireUser } from "@/lib/auth/guards";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PageProps = {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ week?: string; locationId?: string }>;
};

export default async function TeamDetailPage({ params, searchParams }: PageProps) {
  const user = await requireUser();
  const { teamId } = await params;
  const query = await searchParams;

  const employeeIds =
    user.role === Role.MANAGER
      ? user.employeeId
        ? await getReportingTreeIds(user.employeeId)
        : []
      : undefined;

  const data = await getTeamDetailData({
    teamId,
    weekStart: query.week,
    locationId: query.locationId,
    employeeIds,
  });

  if (user.role === Role.MANAGER && !data.rows.length) {
    redirect("/unauthorized");
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{data.team.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Week of {data.selectedWeekStart}. Schedule: {data.team.scheduleDays.join(", ")}
        </p>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Compliant</CardDescription>
            <CardTitle className="text-3xl">{data.summary.compliantPct.toFixed(1)}%</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Avg Days In Office</CardDescription>
            <CardTitle className="text-3xl">{data.summary.avgDaysInOffice.toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Non-Compliant</CardDescription>
            <CardTitle className="text-3xl">{data.summary.nonCompliantCount}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Week Heatmap</CardTitle>
          <CardDescription>Employees x weekdays (green = present, gray = absent, muted = holiday)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                {data.weekdays.map((date) => (
                  <TableHead key={date} className="text-center">
                    {date.slice(5)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Actual / Required</TableHead>
                <TableHead className="text-right">Adherence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.employeeId}>
                  <TableCell>
                    <Link href={`/employees/${row.employeeId}?week=${data.selectedWeekStart}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                  </TableCell>
                  {row.daily.map((day) => (
                    <TableCell key={day.date} className="text-center">
                      {!day.eligible ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-xs text-muted-foreground">
                          H
                        </span>
                      ) : day.present ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/20 text-xs text-emerald-700">
                          ✓
                        </span>
                      ) : day.scheduled ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-red-500/20 text-xs text-red-700">
                          •
                        </span>
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-xs text-muted-foreground">
                          -
                        </span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Badge variant={row.policyCompliant ? "success" : "danger"}>
                      {row.actualDays} / {row.requiredDaysAdjusted}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{row.scheduleAdherencePct.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
