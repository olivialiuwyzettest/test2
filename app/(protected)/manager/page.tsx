import Link from "next/link";
import { Role } from "@prisma/client";
import { format } from "date-fns";
import { getManagerDashboardData } from "@/lib/attendance/compliance";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/server/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SearchParams = Promise<{
  week?: string;
  managerId?: string;
}>;

export default async function ManagerDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;

  let managerEmployeeId: string | null = null;
  if (user.role === Role.MANAGER) {
    managerEmployeeId = user.employeeId;
  } else {
    managerEmployeeId = params.managerId ?? user.employeeId;
  }

  if (!managerEmployeeId) {
    const managers = await db.employee.findMany({
      where: { reports: { some: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 1,
    });
    managerEmployeeId = managers[0]?.id ?? null;
  }

  if (!managerEmployeeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manager Dashboard</CardTitle>
          <CardDescription>
            No managers were found. Import roster data to populate reporting chains.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = await getManagerDashboardData({
    managerEmployeeId,
    weekStart: params.week,
  });

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Manager Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Direct report compliance for {data.manager.name} ({data.manager.email}).
          </p>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Week Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-3 md:max-w-sm">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Week Start (Mon)
              </label>
              <Input name="week" type="date" defaultValue={data.selectedWeekStart} />
            </div>
            {user.role !== Role.MANAGER ? (
              <input name="managerId" type="hidden" value={data.manager.employeeId} />
            ) : null}
            <Button type="submit">Apply</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Direct Reports</CardTitle>
          <CardDescription>
            Required days are adjusted for eligible workdays and configured holidays.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Actual / Required</TableHead>
                <TableHead className="text-right">Deficit</TableHead>
                <TableHead className="text-right">Schedule Adherence</TableHead>
                <TableHead className="text-right">Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.employeeId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link href={`/employees/${row.employeeId}?week=${data.selectedWeekStart}`} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                      <Badge variant={row.policyCompliant ? "success" : "danger"}>
                        {row.policyCompliant ? "Compliant" : "At risk"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.actualDays} / {row.requiredDaysAdjusted}
                  </TableCell>
                  <TableCell className="text-right">{row.deficit}</TableCell>
                  <TableCell className="text-right">{row.scheduleAdherencePct.toFixed(1)}%</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {row.lastSeenAt ? format(row.lastSeenAt, "MMM d, HH:mm") : "No entry"}
                  </TableCell>
                </TableRow>
              ))}
              {!data.rows.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No direct reports found for this manager.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
