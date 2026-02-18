import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { getLeaderDashboardData } from "@/lib/attendance/compliance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { ComplianceLineChart } from "@/components/charts/compliance-line";
import { Sparkline } from "@/components/charts/sparkline";

type SearchParams = Promise<{
  week?: string;
  teamId?: string;
  locationId?: string;
}>;

function metricDelta(current: number, previous: number): string {
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta > 0) return `+${delta.toFixed(1)} pts`;
  if (delta < 0) return `${delta.toFixed(1)} pts`;
  return "No change";
}

export default async function LeaderDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole([Role.ADMIN, Role.LEADER]);
  const params = await searchParams;

  const data = await getLeaderDashboardData({
    weekStart: params.week,
    teamId: params.teamId,
    locationId: params.locationId,
  });

  const exportUrl = `/api/export/compliance?week=${data.selectedWeekStart}${data.filters.teamId ? `&teamId=${data.filters.teamId}` : ""}${data.filters.locationId ? `&locationId=${data.filters.locationId}` : ""}`;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Leader Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly RTO compliance view across teams and locations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={exportUrl}>Export CSV</a>
          </Button>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Week Start (Mon)
              </label>
              <Input name="week" type="date" defaultValue={data.selectedWeekStart} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Team
              </label>
              <Select name="teamId" defaultValue={data.filters.teamId ?? ""}>
                <option value="">All teams</option>
                {data.teamsList.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Location
              </label>
              <Select name="locationId" defaultValue={data.filters.locationId ?? ""}>
                <option value="">All locations</option>
                {data.locationsList.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" className="w-full">
                Apply
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>This Week</CardDescription>
            <CardTitle className="text-3xl">{data.overall.thisWeekCompliancePct.toFixed(1)}%</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Last Week</CardDescription>
            <CardTitle className="text-3xl">{data.overall.lastWeekCompliancePct.toFixed(1)}%</CardTitle>
            <p className="text-xs text-muted-foreground">
              {metricDelta(data.overall.thisWeekCompliancePct, data.overall.lastWeekCompliancePct)}
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Trailing 8 Weeks</CardDescription>
            <CardTitle className="text-3xl">{data.overall.trailing8WeekCompliancePct.toFixed(1)}%</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Non-Compliant Employees</CardDescription>
            <CardTitle className="text-3xl">{data.overall.nonCompliantCount}</CardTitle>
            <p className="text-xs text-muted-foreground">out of {data.overall.employeeCount}</p>
          </CardHeader>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Compliance Trend</CardTitle>
            <CardDescription>Trailing 8 weeks (compliance %)</CardDescription>
          </CardHeader>
          <CardContent>
            <ComplianceLineChart data={data.trend} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Policy Snapshot</CardTitle>
            <CardDescription>Week of {data.selectedWeekStart}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Rule:</span> minimum 3 office days/week,
              adjusted for eligible workdays and holidays.
            </p>
            <p>
              <span className="text-muted-foreground">Holidays:</span> custom Wyze calendar,
              configurable per location.
            </p>
            <p>
              <span className="text-muted-foreground">Schedule Adherence:</span> attendance on
              scheduled days / scheduled eligible days.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>
            Drill into team heatmaps and weekly adherence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Compliant %</TableHead>
                <TableHead className="text-right">Non-Compliant</TableHead>
                <TableHead className="text-right">Avg Days</TableHead>
                <TableHead className="text-right">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.teams.map((team) => (
                <TableRow key={team.teamId}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/teams/${team.teamId}?week=${data.selectedWeekStart}`}
                    >
                      {team.teamName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={team.compliantPct >= 80 ? "success" : "danger"}>
                      {team.compliantPct.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{team.nonCompliantCount}</TableCell>
                  <TableCell className="text-right">{team.avgDaysInOffice.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end">
                      <Sparkline points={team.trend} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!data.teams.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No active employees match the selected filters.
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
