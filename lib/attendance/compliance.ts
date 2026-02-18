import {
  EmployeeStatus,
  Prisma,
  Role,
  Weekday,
} from "@prisma/client";
import { parseISO, subWeeks } from "date-fns";
import { env } from "@/lib/env";
import { db } from "@/lib/server/db";
import { mondayOfWeek, parseIsoDate, weekdaysForWeek } from "@/lib/utils/date";

const WEEKDAY_BY_INDEX: Record<number, Weekday> = {
  0: Weekday.SUN,
  1: Weekday.MON,
  2: Weekday.TUE,
  3: Weekday.WED,
  4: Weekday.THU,
  5: Weekday.FRI,
  6: Weekday.SAT,
};

type EmployeeWithTeam = Prisma.EmployeeGetPayload<{
  include: { team: true; officeLocation: true };
}>;

type AttendanceRecord = {
  present: boolean;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  officeLocationId: string | null;
};

type WeeklyComputationContext = {
  holidaysGlobal: Set<string>;
  holidaysByLocation: Map<string, Set<string>>;
  attendanceByEmployeeAndDate: Map<string, AttendanceRecord>;
};

export type WeeklyEmployeeRow = {
  employeeId: string;
  name: string;
  email: string;
  teamId: string;
  teamName: string;
  requiredDaysAdjusted: number;
  actualDays: number;
  deficit: number;
  policyCompliant: boolean;
  scheduleAdherencePct: number;
  attendedOnScheduledDays: number;
  scheduledEligibleDays: number;
  lastSeenAt: Date | null;
};

export type LeaderTeamRow = {
  teamId: string;
  teamName: string;
  compliantPct: number;
  nonCompliantCount: number;
  avgDaysInOffice: number;
  trend: number[];
};

export type LeaderDashboardData = {
  selectedWeekStart: string;
  lastWeekStart: string;
  filters: {
    teamId: string | null;
    locationId: string | null;
  };
  overall: {
    thisWeekCompliancePct: number;
    lastWeekCompliancePct: number;
    trailing8WeekCompliancePct: number;
    nonCompliantCount: number;
    employeeCount: number;
  };
  teams: LeaderTeamRow[];
  trend: Array<{ weekStart: string; compliancePct: number }>;
  teamsList: Array<{ id: string; name: string }>;
  locationsList: Array<{ id: string; name: string }>;
};

export type ManagerDashboardData = {
  manager: { employeeId: string; name: string; email: string };
  selectedWeekStart: string;
  rows: WeeklyEmployeeRow[];
};

export type TeamDetailData = {
  team: {
    id: string;
    name: string;
    scheduleDays: Weekday[];
    requiredDaysPerWeek: number;
  };
  selectedWeekStart: string;
  weekdays: string[];
  rows: Array<
    WeeklyEmployeeRow & {
      daily: Array<{
        date: string;
        weekday: Weekday;
        eligible: boolean;
        scheduled: boolean;
        present: boolean;
      }>;
    }
  >;
  summary: {
    compliantPct: number;
    avgDaysInOffice: number;
    nonCompliantCount: number;
  };
};

export type EmployeeTrendPoint = {
  weekStart: string;
  actualDays: number;
  requiredDaysAdjusted: number;
  compliant: boolean;
  scheduleAdherencePct: number;
};

export type EmployeeDetailData = {
  employee: {
    id: string;
    name: string;
    email: string;
    teamName: string;
    managerName: string | null;
    roleHint: Role | null;
  };
  weekStart: string;
  weekdays: string[];
  dailyPresence: Array<{
    date: string;
    weekday: Weekday;
    scheduled: boolean;
    eligible: boolean;
    present: boolean;
    firstSeenAt: Date | null;
    lastSeenAt: Date | null;
  }>;
  trend: EmployeeTrendPoint[];
  rawEvents: Array<{
    id: string;
    occurredAt: Date;
    eventType: string | null;
    securityAction: string | null;
  }>;
};

export function resolveWeekStart(weekInput: string | null | undefined, timezone: string): string {
  const parsed = parseIsoDate(weekInput);
  return mondayOfWeek(parsed ? parseISO(`${parsed}T00:00:00.000Z`) : new Date(), timezone);
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftWeek(weekStart: string, offsetWeeks: number): string {
  return addDaysToDateKey(weekStart, offsetWeeks * 7);
}

function buildWeekKeys(targetWeekStart: string, weeks: number): string[] {
  const start = shiftWeek(targetWeekStart, -(weeks - 1));
  return Array.from({ length: weeks }, (_, index) => shiftWeek(start, index));
}

function dateRangeForWeeks(weekKeys: string[]): { start: Date; end: Date } {
  const first = weekKeys[0];
  const last = weekKeys[weekKeys.length - 1];
  return {
    start: new Date(`${first}T00:00:00.000Z`),
    end: new Date(`${addDaysToDateKey(last, 4)}T23:59:59.999Z`),
  };
}

function weekdayForDateKey(dateKey: string): Weekday {
  const day = parseISO(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return WEEKDAY_BY_INDEX[day];
}

function percentage(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function attendanceKey(employeeId: string, dateKey: string): string {
  return `${employeeId}:${dateKey}`;
}

function extractDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildWeeklyContext(
  holidays: Array<{ date: Date; officeLocationId: string | null }>,
  attendanceDays: Array<{
    employeeId: string;
    date: Date;
    present: boolean;
    firstSeenAt: Date | null;
    lastSeenAt: Date | null;
    officeLocationId: string | null;
  }>,
): WeeklyComputationContext {
  const holidaysGlobal = new Set<string>();
  const holidaysByLocation = new Map<string, Set<string>>();

  for (const holiday of holidays) {
    const key = extractDateKey(holiday.date);
    if (!holiday.officeLocationId) {
      holidaysGlobal.add(key);
      continue;
    }

    const existing = holidaysByLocation.get(holiday.officeLocationId) ?? new Set<string>();
    existing.add(key);
    holidaysByLocation.set(holiday.officeLocationId, existing);
  }

  const attendanceByEmployeeAndDate = new Map<string, AttendanceRecord>();
  for (const record of attendanceDays) {
    attendanceByEmployeeAndDate.set(attendanceKey(record.employeeId, extractDateKey(record.date)), {
      present: record.present,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      officeLocationId: record.officeLocationId,
    });
  }

  return {
    holidaysGlobal,
    holidaysByLocation,
    attendanceByEmployeeAndDate,
  };
}

function isHoliday(
  dateKey: string,
  officeLocationId: string | null,
  context: WeeklyComputationContext,
): boolean {
  if (context.holidaysGlobal.has(dateKey)) {
    return true;
  }

  if (!officeLocationId) {
    return false;
  }

  return context.holidaysByLocation.get(officeLocationId)?.has(dateKey) ?? false;
}

function computeWeeklyRow(
  employee: EmployeeWithTeam,
  weekStart: string,
  context: WeeklyComputationContext,
): WeeklyEmployeeRow {
  const weekdays = weekdaysForWeek(weekStart, env.appDefaultTimezone);

  let actualDays = 0;
  let scheduledEligibleDays = 0;
  let attendedOnScheduledDays = 0;
  let lastSeenAt: Date | null = null;

  const eligibleDays: string[] = [];

  for (const dateKey of weekdays) {
    if (isHoliday(dateKey, employee.officeLocationId, context)) {
      continue;
    }

    eligibleDays.push(dateKey);
    const weekday = weekdayForDateKey(dateKey);
    const scheduled = employee.team.scheduleDays.includes(weekday);

    if (scheduled) {
      scheduledEligibleDays += 1;
    }

    const attendance = context.attendanceByEmployeeAndDate.get(attendanceKey(employee.id, dateKey));
    const present = attendance?.present ?? false;
    if (present) {
      actualDays += 1;
      if (scheduled) {
        attendedOnScheduledDays += 1;
      }
      if (attendance?.lastSeenAt && (!lastSeenAt || attendance.lastSeenAt > lastSeenAt)) {
        lastSeenAt = attendance.lastSeenAt;
      }
    }
  }

  const requiredDaysAdjusted = Math.min(employee.team.requiredDaysPerWeek, eligibleDays.length);
  const policyCompliant = actualDays >= requiredDaysAdjusted;

  return {
    employeeId: employee.id,
    name: employee.name,
    email: employee.email,
    teamId: employee.teamId,
    teamName: employee.team.name,
    requiredDaysAdjusted,
    actualDays,
    deficit: Math.max(0, requiredDaysAdjusted - actualDays),
    policyCompliant,
    scheduleAdherencePct: percentage(attendedOnScheduledDays, scheduledEligibleDays),
    attendedOnScheduledDays,
    scheduledEligibleDays,
    lastSeenAt,
  };
}

async function loadFilters() {
  const [teams, locations] = await Promise.all([
    db.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.officeLocation.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return {
    teamsList: teams,
    locationsList: locations,
  };
}

async function loadActiveEmployees(filters: {
  teamId?: string | null;
  locationId?: string | null;
  employeeIds?: string[];
}): Promise<EmployeeWithTeam[]> {
  return db.employee.findMany({
    where: {
      status: EmployeeStatus.ACTIVE,
      teamId: filters.teamId ?? undefined,
      officeLocationId: filters.locationId ?? undefined,
      id: filters.employeeIds ? { in: filters.employeeIds } : undefined,
    },
    include: {
      team: true,
      officeLocation: true,
    },
    orderBy: [{ team: { name: "asc" } }, { name: "asc" }],
  });
}

async function loadWeeklyDataset(
  employees: EmployeeWithTeam[],
  weekKeys: string[],
): Promise<WeeklyComputationContext> {
  if (!employees.length) {
    return {
      holidaysGlobal: new Set<string>(),
      holidaysByLocation: new Map<string, Set<string>>(),
      attendanceByEmployeeAndDate: new Map<string, AttendanceRecord>(),
    };
  }

  const employeeIds = employees.map((employee) => employee.id);
  const locationIds = Array.from(
    new Set(employees.map((employee) => employee.officeLocationId).filter((id): id is string => Boolean(id))),
  );

  const range = dateRangeForWeeks(weekKeys);

  const [attendanceDays, holidays] = await Promise.all([
    db.attendanceDay.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: {
          gte: range.start,
          lte: range.end,
        },
      },
      select: {
        employeeId: true,
        date: true,
        present: true,
        firstSeenAt: true,
        lastSeenAt: true,
        officeLocationId: true,
      },
    }),
    db.holiday.findMany({
      where: {
        date: {
          gte: range.start,
          lte: range.end,
        },
        OR: [{ officeLocationId: null }, { officeLocationId: { in: locationIds } }],
      },
      select: {
        date: true,
        officeLocationId: true,
      },
    }),
  ]);

  return buildWeeklyContext(holidays, attendanceDays);
}

function buildRowsForWeek(
  employees: EmployeeWithTeam[],
  weekStart: string,
  context: WeeklyComputationContext,
): WeeklyEmployeeRow[] {
  return employees.map((employee) => computeWeeklyRow(employee, weekStart, context));
}

function compliancePct(rows: WeeklyEmployeeRow[]): number {
  if (!rows.length) return 0;
  const compliantCount = rows.filter((row) => row.policyCompliant).length;
  return percentage(compliantCount, rows.length);
}

export async function getLeaderDashboardData(params: {
  weekStart?: string | null;
  teamId?: string | null;
  locationId?: string | null;
}): Promise<LeaderDashboardData> {
  const selectedWeekStart = resolveWeekStart(params.weekStart, env.appDefaultTimezone);
  const lastWeekStart = shiftWeek(selectedWeekStart, -1);
  const weekKeys = buildWeekKeys(selectedWeekStart, 8);

  const employees = await loadActiveEmployees({
    teamId: params.teamId,
    locationId: params.locationId,
  });

  const context = await loadWeeklyDataset(employees, weekKeys);
  const rowsByWeek = new Map<string, WeeklyEmployeeRow[]>();
  for (const weekKey of weekKeys) {
    rowsByWeek.set(weekKey, buildRowsForWeek(employees, weekKey, context));
  }

  const thisWeekRows = rowsByWeek.get(selectedWeekStart) ?? [];
  const lastWeekRows = rowsByWeek.get(lastWeekStart) ?? [];

  const trend = weekKeys.map((weekKey) => ({
    weekStart: weekKey,
    compliancePct: compliancePct(rowsByWeek.get(weekKey) ?? []),
  }));

  const trailing8WeekCompliancePct = average(trend.map((point) => point.compliancePct));

  const byTeam = new Map<string, WeeklyEmployeeRow[]>();
  for (const row of thisWeekRows) {
    const teamRows = byTeam.get(row.teamId) ?? [];
    teamRows.push(row);
    byTeam.set(row.teamId, teamRows);
  }

  const teamTrendByTeam = new Map<string, number[]>();
  for (const weekKey of weekKeys) {
    const rows = rowsByWeek.get(weekKey) ?? [];
    const grouped = new Map<string, WeeklyEmployeeRow[]>();
    for (const row of rows) {
      const existing = grouped.get(row.teamId) ?? [];
      existing.push(row);
      grouped.set(row.teamId, existing);
    }

    for (const [teamId, teamRows] of grouped.entries()) {
      const existingTrend = teamTrendByTeam.get(teamId) ?? [];
      existingTrend.push(compliancePct(teamRows));
      teamTrendByTeam.set(teamId, existingTrend);
    }
  }

  const teams = Array.from(byTeam.entries())
    .map(([teamId, rows]): LeaderTeamRow => ({
      teamId,
      teamName: rows[0]?.teamName ?? teamId,
      compliantPct: compliancePct(rows),
      nonCompliantCount: rows.filter((row) => !row.policyCompliant).length,
      avgDaysInOffice: average(rows.map((row) => row.actualDays)),
      trend: teamTrendByTeam.get(teamId) ?? [],
    }))
    .sort((a, b) => b.nonCompliantCount - a.nonCompliantCount || a.teamName.localeCompare(b.teamName));

  const { teamsList, locationsList } = await loadFilters();

  return {
    selectedWeekStart,
    lastWeekStart,
    filters: {
      teamId: params.teamId ?? null,
      locationId: params.locationId ?? null,
    },
    overall: {
      thisWeekCompliancePct: compliancePct(thisWeekRows),
      lastWeekCompliancePct: compliancePct(lastWeekRows),
      trailing8WeekCompliancePct,
      nonCompliantCount: thisWeekRows.filter((row) => !row.policyCompliant).length,
      employeeCount: thisWeekRows.length,
    },
    teams,
    trend,
    teamsList,
    locationsList,
  };
}

export async function getReportingTreeIds(managerEmployeeId: string): Promise<string[]> {
  const allowed = new Set<string>();
  let frontier = [managerEmployeeId];

  while (frontier.length) {
    const directReports = await db.employee.findMany({
      where: {
        managerEmployeeId: { in: frontier },
        status: EmployeeStatus.ACTIVE,
      },
      select: { id: true },
    });

    frontier = [];
    for (const report of directReports) {
      if (!allowed.has(report.id)) {
        allowed.add(report.id);
        frontier.push(report.id);
      }
    }
  }

  return Array.from(allowed);
}

export async function getManagerDashboardData(params: {
  managerEmployeeId: string;
  weekStart?: string | null;
}): Promise<ManagerDashboardData> {
  const selectedWeekStart = resolveWeekStart(params.weekStart, env.appDefaultTimezone);
  const reports = await getReportingTreeIds(params.managerEmployeeId);
  const employees = await loadActiveEmployees({ employeeIds: reports });
  const context = await loadWeeklyDataset(employees, [selectedWeekStart]);
  const rows = buildRowsForWeek(employees, selectedWeekStart, context).sort(
    (a, b) => b.deficit - a.deficit || b.scheduleAdherencePct - a.scheduleAdherencePct,
  );

  const manager = await db.employee.findUniqueOrThrow({
    where: { id: params.managerEmployeeId },
    select: { id: true, name: true, email: true },
  });

  return {
    manager: {
      employeeId: manager.id,
      name: manager.name,
      email: manager.email,
    },
    selectedWeekStart,
    rows,
  };
}

export async function getTeamDetailData(params: {
  teamId: string;
  weekStart?: string | null;
  locationId?: string | null;
  employeeIds?: string[];
}): Promise<TeamDetailData> {
  const selectedWeekStart = resolveWeekStart(params.weekStart, env.appDefaultTimezone);
  const weekdays = weekdaysForWeek(selectedWeekStart, env.appDefaultTimezone);

  const team = await db.team.findUniqueOrThrow({
    where: { id: params.teamId },
    select: {
      id: true,
      name: true,
      scheduleDays: true,
      requiredDaysPerWeek: true,
    },
  });

  const employees = await loadActiveEmployees({
    teamId: params.teamId,
    locationId: params.locationId,
    employeeIds: params.employeeIds,
  });

  const context = await loadWeeklyDataset(employees, [selectedWeekStart]);
  const baseRows = buildRowsForWeek(employees, selectedWeekStart, context);

  const rows = baseRows.map((row) => {
    const employee = employees.find((candidate) => candidate.id === row.employeeId);
    const daily = weekdays.map((date) => {
      const weekday = weekdayForDateKey(date);
      const scheduled = employee?.team.scheduleDays.includes(weekday) ?? false;
      const eligible = !isHoliday(date, employee?.officeLocationId ?? null, context);
      const present = context.attendanceByEmployeeAndDate.get(attendanceKey(row.employeeId, date))?.present ?? false;
      return {
        date,
        weekday,
        eligible,
        scheduled,
        present,
      };
    });

    return {
      ...row,
      daily,
    };
  });

  return {
    team,
    selectedWeekStart,
    weekdays,
    rows,
    summary: {
      compliantPct: compliancePct(baseRows),
      avgDaysInOffice: average(baseRows.map((row) => row.actualDays)),
      nonCompliantCount: baseRows.filter((row) => !row.policyCompliant).length,
    },
  };
}

export async function getEmployeeDetailData(params: {
  employeeId: string;
  weekStart?: string | null;
  includeRawEvents: boolean;
}): Promise<EmployeeDetailData> {
  const weekStart = resolveWeekStart(params.weekStart, env.appDefaultTimezone);
  const weekKeys = buildWeekKeys(weekStart, 8);
  const weekdays = weekdaysForWeek(weekStart, env.appDefaultTimezone);

  const employee = await db.employee.findUniqueOrThrow({
    where: { id: params.employeeId },
    include: {
      team: true,
      manager: true,
      officeLocation: true,
    },
  });

  const [appUser, context] = await Promise.all([
    db.appUser.findUnique({ where: { email: employee.email }, select: { role: true } }),
    loadWeeklyDataset([employee], weekKeys),
  ]);

  const trend = weekKeys.map((candidateWeekStart) => {
    const row = computeWeeklyRow(employee, candidateWeekStart, context);
    return {
      weekStart: candidateWeekStart,
      actualDays: row.actualDays,
      requiredDaysAdjusted: row.requiredDaysAdjusted,
      compliant: row.policyCompliant,
      scheduleAdherencePct: row.scheduleAdherencePct,
    };
  });

  const dailyPresence = weekdays.map((date) => {
    const weekday = weekdayForDateKey(date);
    const scheduled = employee.team.scheduleDays.includes(weekday);
    const eligible = !isHoliday(date, employee.officeLocationId, context);
    const attendance = context.attendanceByEmployeeAndDate.get(attendanceKey(employee.id, date));

    return {
      date,
      weekday,
      scheduled,
      eligible,
      present: attendance?.present ?? false,
      firstSeenAt: attendance?.firstSeenAt ?? null,
      lastSeenAt: attendance?.lastSeenAt ?? null,
    };
  });

  const rawEvents = params.includeRawEvents && employee.brivoUserId
    ? await db.brivoEventRaw.findMany({
        where: {
          brivoUserId: employee.brivoUserId,
        },
        orderBy: {
          occurredAt: "desc",
        },
        take: 50,
        select: {
          id: true,
          occurredAt: true,
          eventType: true,
          securityAction: true,
        },
      })
    : [];

  return {
    employee: {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      teamName: employee.team.name,
      managerName: employee.manager?.name ?? null,
      roleHint: appUser?.role ?? null,
    },
    weekStart,
    weekdays,
    dailyPresence,
    trend,
    rawEvents,
  };
}

export async function getOptionsForFilters() {
  return loadFilters();
}

export async function listTeamSchedules() {
  return db.team.findMany({
    orderBy: { name: "asc" },
    include: {
      employees: {
        where: { status: EmployeeStatus.ACTIVE },
        select: { id: true },
      },
    },
  });
}

export async function listDoorsWithLocation() {
  return db.door.findMany({
    orderBy: [{ officeLocation: { name: "asc" } }, { name: "asc" }],
    include: {
      officeLocation: {
        select: { id: true, name: true, timezone: true },
      },
    },
  });
}

export async function listHolidays() {
  return db.holiday.findMany({
    orderBy: [{ date: "asc" }, { name: "asc" }],
    include: {
      officeLocation: {
        select: { id: true, name: true },
      },
    },
  });
}

export async function listEmployeeMappings() {
  return db.employee.findMany({
    where: { status: EmployeeStatus.ACTIVE },
    orderBy: { name: "asc" },
    include: {
      team: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true } },
    },
  });
}

export function recentWeekStart(offsetWeeks = 0): string {
  const base = mondayOfWeek(new Date(), env.appDefaultTimezone);
  return shiftWeek(base, offsetWeeks);
}

export function trailingWeekStarts(weeks: number): string[] {
  const latest = recentWeekStart(0);
  return buildWeekKeys(latest, weeks);
}

export function suggestedReconciliationRange() {
  const todayWeekStart = mondayOfWeek(new Date(), env.appDefaultTimezone);
  return {
    fromWeekStart: shiftWeek(todayWeekStart, -1),
    toWeekStart: todayWeekStart,
  };
}

export function defaultPollingWindow() {
  const end = new Date();
  const start = subWeeks(end, 1);
  return { start, end };
}

export async function getWeeklyRowsForExport(params: {
  weekStart?: string | null;
  teamId?: string | null;
  locationId?: string | null;
  managerEmployeeId?: string | null;
}): Promise<{ weekStart: string; rows: WeeklyEmployeeRow[] }> {
  const weekStart = resolveWeekStart(params.weekStart, env.appDefaultTimezone);

  let employeeIds: string[] | undefined;
  if (params.managerEmployeeId) {
    employeeIds = await getReportingTreeIds(params.managerEmployeeId);
  }

  const employees = await loadActiveEmployees({
    teamId: params.teamId,
    locationId: params.locationId,
    employeeIds,
  });

  const context = await loadWeeklyDataset(employees, [weekStart]);
  const rows = buildRowsForWeek(employees, weekStart, context).sort((a, b) =>
    a.teamName === b.teamName
      ? a.name.localeCompare(b.name)
      : a.teamName.localeCompare(b.teamName),
  );

  return {
    weekStart,
    rows,
  };
}
