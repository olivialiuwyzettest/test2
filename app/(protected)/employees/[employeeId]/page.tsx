import { Role } from "@prisma/client";
import { format } from "date-fns";
import { redirect } from "next/navigation";
import {
  getEmployeeDetailData,
  getReportingTreeIds,
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
import { EmployeeWeeklyTrendChart } from "@/components/charts/employee-weekly-trend";

type PageProps = {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ week?: string }>;
};

export default async function EmployeeDetailPage({ params, searchParams }: PageProps) {
  const user = await requireUser();
  const { employeeId } = await params;
  const query = await searchParams;

  if (user.role === Role.MANAGER) {
    if (!user.employeeId) {
      redirect("/unauthorized");
    }

    const visibleEmployeeIds = new Set(await getReportingTreeIds(user.employeeId));
    if (!visibleEmployeeIds.has(employeeId)) {
      redirect("/unauthorized");
    }
  }

  const includeRawEvents = user.role === Role.ADMIN;
  const data = await getEmployeeDetailData({
    employeeId,
    weekStart: query.week,
    includeRawEvents,
  });

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{data.employee.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.employee.email} • {data.employee.teamName}
          {data.employee.managerName ? ` • Manager: ${data.employee.managerName}` : ""}
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Weekly Trend</CardTitle>
            <CardDescription>Actual vs required days over the trailing 8 weeks.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmployeeWeeklyTrendChart data={data.trend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current Week</CardTitle>
            <CardDescription>Week of {data.weekStart}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.dailyPresence.map((day) => (
              <div key={day.date} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{day.date} ({day.weekday})</p>
                  <p className="text-xs text-muted-foreground">
                    {day.eligible ? "Eligible" : "Holiday"} • {day.scheduled ? "Scheduled" : "Unscheduled"}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant={day.present ? "success" : day.scheduled && day.eligible ? "danger" : "neutral"}>
                    {day.present ? "Present" : "Absent"}
                  </Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {day.firstSeenAt ? `First: ${format(day.firstSeenAt, "HH:mm")}` : "-"}
                    {day.lastSeenAt ? ` • Last: ${format(day.lastSeenAt, "HH:mm")}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {includeRawEvents ? (
        <Card>
          <CardHeader>
            <CardTitle>Raw Event Timestamps (Admin Only)</CardTitle>
            <CardDescription>Most recent Brivo raw events linked to this employee.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Occurred At</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Security Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rawEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{format(event.occurredAt, "yyyy-MM-dd HH:mm:ss")}</TableCell>
                    <TableCell>{event.eventType ?? "-"}</TableCell>
                    <TableCell>{event.securityAction ?? "-"}</TableCell>
                  </TableRow>
                ))}
                {!data.rawEvents.length ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                      No raw events available for this employee.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
