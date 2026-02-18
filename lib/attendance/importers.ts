import { EmployeeStatus, Weekday } from "@prisma/client";
import { parseIsoDate } from "@/lib/utils/date";
import { parseCsvRows } from "@/lib/utils/csv";
import { db } from "@/lib/server/db";

type ImportSummary = {
  created: number;
  updated: number;
  skipped: number;
};

function normalize(value: string | undefined): string {
  return (value ?? "").trim();
}

function normalizeEmail(value: string | undefined): string {
  return normalize(value).toLowerCase();
}

function parseEmployeeStatus(value: string | undefined): EmployeeStatus {
  return normalize(value).toUpperCase() === "INACTIVE"
    ? EmployeeStatus.INACTIVE
    : EmployeeStatus.ACTIVE;
}

function defaultSchedule(): Weekday[] {
  return [Weekday.MON, Weekday.TUE, Weekday.THU];
}

function parseScheduleDays(rawValue: string | undefined): Weekday[] | null {
  const value = normalize(rawValue);
  if (!value) return null;

  const parsed = value
    .split(/[|,]/)
    .map((token) => token.trim().toUpperCase())
    .map((token) => {
      if (token.startsWith("MON")) return Weekday.MON;
      if (token.startsWith("TUE")) return Weekday.TUE;
      if (token.startsWith("WED")) return Weekday.WED;
      if (token.startsWith("THU")) return Weekday.THU;
      if (token.startsWith("FRI")) return Weekday.FRI;
      if (token.startsWith("SAT")) return Weekday.SAT;
      if (token.startsWith("SUN")) return Weekday.SUN;
      return null;
    })
    .filter((day): day is Weekday => day !== null);

  return parsed.length ? parsed : null;
}

async function getOrCreateTeam(nameInput: string, scheduleDaysRaw?: string, requiredDaysRaw?: string) {
  const name = normalize(nameInput);
  const requiredDays = Number.parseInt(normalize(requiredDaysRaw), 10);
  const scheduleDays = parseScheduleDays(scheduleDaysRaw) ?? defaultSchedule();

  const existing = await db.team.findUnique({ where: { name } });
  if (existing) {
    return existing;
  }

  return db.team.create({
    data: {
      name,
      scheduleDays,
      requiredDaysPerWeek: Number.isFinite(requiredDays) ? requiredDays : 3,
    },
  });
}

async function getOrCreateOffice(nameInput: string, timezoneInput?: string) {
  const name = normalize(nameInput);
  if (!name) return null;

  const existing = await db.officeLocation.findUnique({ where: { name } });
  if (existing) {
    return existing;
  }

  return db.officeLocation.create({
    data: {
      name,
      timezone: normalize(timezoneInput) || "America/Los_Angeles",
    },
  });
}

export async function importRosterCsv(csvText: string): Promise<ImportSummary> {
  const rows = parseCsvRows(csvText);
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };

  const managerLinks: Array<{ employeeEmail: string; managerEmail: string }> = [];

  for (const row of rows) {
    const email = normalizeEmail(row.email ?? row.employeeemail);
    const name = normalize(row.name ?? row.employeename);
    const teamName = normalize(row.team ?? row.teamname);
    if (!email || !name || !teamName) {
      summary.skipped += 1;
      continue;
    }

    const team = await getOrCreateTeam(
      teamName,
      row.scheduledays,
      row.requireddaysperweek ?? row.requireddays,
    );

    const office = await getOrCreateOffice(row.officelocation ?? row.location, row.timezone);

    const existing = await db.employee.findUnique({ where: { email } });
    if (existing) {
      await db.employee.update({
        where: { id: existing.id },
        data: {
          name,
          teamId: team.id,
          officeLocationId: office?.id ?? existing.officeLocationId,
          status: parseEmployeeStatus(row.status),
          brivoUserId: normalize(row.brivouserid) || existing.brivoUserId,
        },
      });
      summary.updated += 1;
    } else {
      await db.employee.create({
        data: {
          email,
          name,
          teamId: team.id,
          officeLocationId: office?.id,
          status: parseEmployeeStatus(row.status),
          brivoUserId: normalize(row.brivouserid) || null,
        },
      });
      summary.created += 1;
    }

    const managerEmail = normalizeEmail(row.manageremail ?? row.manager);
    if (managerEmail) {
      managerLinks.push({ employeeEmail: email, managerEmail });
    }
  }

  if (managerLinks.length) {
    const allEmails = Array.from(
      new Set(
        managerLinks.flatMap((item) => [item.employeeEmail, item.managerEmail]),
      ),
    );

    const employees = await db.employee.findMany({
      where: {
        email: {
          in: allEmails,
        },
      },
      select: { id: true, email: true },
    });

    const employeeByEmail = new Map(employees.map((employee) => [employee.email, employee.id]));

    const updates: Array<Promise<unknown>> = [];
    for (const link of managerLinks) {
      const employeeId = employeeByEmail.get(link.employeeEmail);
      const managerId = employeeByEmail.get(link.managerEmail);
      if (!employeeId || !managerId || employeeId === managerId) {
        continue;
      }

      updates.push(
        db.employee.update({
          where: { id: employeeId },
          data: { managerEmployeeId: managerId },
        }),
      );
    }

    if (updates.length) {
      await Promise.all(updates);
    }
  }

  return summary;
}

function parseHolidayRows(input: string): Array<{ date: string; name: string; officeLocationName?: string }> {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { holidays?: unknown[] }).holidays)
        ? ((parsed as { holidays: unknown[] }).holidays)
        : [];

    const output: Array<{ date: string; name: string; officeLocationName?: string }> = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const date = normalize(String(item.date ?? ""));
      const name = normalize(String(item.name ?? item.holiday ?? ""));
      const officeLocationName = normalize(String(item.officelocation ?? item.location ?? ""));
      if (!date || !name) continue;
      output.push({ date, name, officeLocationName: officeLocationName || undefined });
    }
    return output;
  }

  const output: Array<{ date: string; name: string; officeLocationName?: string }> = [];
  for (const row of parseCsvRows(trimmed)) {
    const date = normalize(row.date);
    const name = normalize(row.name ?? row.holiday);
    const officeLocationName = normalize(row.officelocation ?? row.location);
    if (!date || !name) continue;
    output.push({ date, name, officeLocationName: officeLocationName || undefined });
  }
  return output;
}

export async function importHolidays(input: string): Promise<ImportSummary> {
  const rows = parseHolidayRows(input);
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };

  for (const row of rows) {
    const dateKey = parseIsoDate(row.date);
    if (!dateKey) {
      summary.skipped += 1;
      continue;
    }

    const office = row.officeLocationName
      ? await getOrCreateOffice(row.officeLocationName)
      : null;

    const existing = await db.holiday.findFirst({
      where: {
        date: new Date(`${dateKey}T00:00:00.000Z`),
        name: row.name,
        officeLocationId: office?.id ?? null,
      },
    });

    if (existing) {
      await db.holiday.update({
        where: { id: existing.id },
        data: { name: row.name },
      });
      summary.updated += 1;
      continue;
    }

    await db.holiday.create({
      data: {
        date: new Date(`${dateKey}T00:00:00.000Z`),
        name: row.name,
        officeLocationId: office?.id ?? null,
      },
    });
    summary.created += 1;
  }

  return summary;
}

export async function importBrivoMappings(csvText: string): Promise<ImportSummary> {
  const rows = parseCsvRows(csvText);
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };

  for (const row of rows) {
    const employeeEmail = normalizeEmail(row.employeeemail ?? row.email);
    const brivoUserId = normalize(row.brivouserid ?? row.brivoid);

    if (!employeeEmail || !brivoUserId) {
      summary.skipped += 1;
      continue;
    }

    const result = await db.employee.updateMany({
      where: { email: employeeEmail },
      data: { brivoUserId },
    });

    if (result.count === 0) {
      summary.skipped += 1;
    } else {
      summary.updated += result.count;
    }
  }

  return summary;
}

export function toCsv(rows: Array<Record<string, string | number | boolean | null | undefined>>): string {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const escape = (value: string | number | boolean | null | undefined) => {
    const text = value == null ? "" : String(value);
    if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
      return `"${text.replaceAll("\"", "\"\"")}"`;
    }
    return text;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
}
