import {
  AttendanceSource,
  EmployeeStatus,
  PrismaClient,
  Role,
  Weekday,
} from "@prisma/client";
import { addDays, formatISO, startOfWeek, subWeeks } from "date-fns";

const prisma = new PrismaClient();

const WEEKDAY_BY_INDEX: Record<number, Weekday> = {
  0: Weekday.SUN,
  1: Weekday.MON,
  2: Weekday.TUE,
  3: Weekday.WED,
  4: Weekday.THU,
  5: Weekday.FRI,
  6: Weekday.SAT,
};

function ymd(date: Date): string {
  return formatISO(date, { representation: "date" });
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  return hash;
}

function shouldAttend(email: string, dateKey: string, probability: number): boolean {
  const value = stableHash(`${email}:${dateKey}`) % 1000;
  return value < Math.floor(probability * 1000);
}

async function clearDatabase() {
  await prisma.attendanceDay.deleteMany();
  await prisma.brivoEventRaw.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.door.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.team.deleteMany();
  await prisma.officeLocation.deleteMany();
  await prisma.appUser.deleteMany();
  await prisma.ingestionCursor.deleteMany();
  await prisma.appSetting.deleteMany();
}

async function main() {
  await clearDatabase();

  const office = await prisma.officeLocation.create({
    data: {
      name: "Seattle HQ",
      timezone: "America/Los_Angeles",
      brivoSiteId: "site-sea-hq",
    },
  });

  const doors = await Promise.all([
    prisma.door.create({
      data: {
        officeLocationId: office.id,
        brivoDoorId: "door-main-lobby",
        name: "Main Lobby",
        countsForEntry: true,
      },
    }),
    prisma.door.create({
      data: {
        officeLocationId: office.id,
        brivoDoorId: "door-north-garage",
        name: "North Garage",
        countsForEntry: false,
      },
    }),
    prisma.door.create({
      data: {
        officeLocationId: office.id,
        brivoDoorId: "door-east-elevator",
        name: "East Elevator Lobby",
        countsForEntry: true,
      },
    }),
  ]);

  const productTeam = await prisma.team.create({
    data: {
      name: "Product",
      scheduleDays: [Weekday.MON, Weekday.WED, Weekday.THU],
      requiredDaysPerWeek: 3,
    },
  });

  const engineeringTeam = await prisma.team.create({
    data: {
      name: "Engineering",
      scheduleDays: [Weekday.TUE, Weekday.WED, Weekday.THU],
      requiredDaysPerWeek: 3,
    },
  });

  const supportTeam = await prisma.team.create({
    data: {
      name: "Customer Experience",
      scheduleDays: [Weekday.MON, Weekday.TUE, Weekday.FRI],
      requiredDaysPerWeek: 3,
    },
  });

  const productManager = await prisma.employee.create({
    data: {
      email: "manager.product@wyze.com",
      name: "Paula Product",
      teamId: productTeam.id,
      officeLocationId: office.id,
      status: EmployeeStatus.ACTIVE,
      brivoUserId: "brivo_u_paula_product",
    },
  });

  const engineeringManager = await prisma.employee.create({
    data: {
      email: "manager.eng@wyze.com",
      name: "Ethan Engineering",
      teamId: engineeringTeam.id,
      officeLocationId: office.id,
      status: EmployeeStatus.ACTIVE,
      brivoUserId: "brivo_u_ethan_engineering",
    },
  });

  const supportManager = await prisma.employee.create({
    data: {
      email: "manager.cx@wyze.com",
      name: "Cora CX",
      teamId: supportTeam.id,
      officeLocationId: office.id,
      status: EmployeeStatus.ACTIVE,
      brivoUserId: "brivo_u_cora_cx",
    },
  });

  const employeeFixtures = [
    {
      email: "alice.pm@wyze.com",
      name: "Alice PM",
      teamId: productTeam.id,
      managerEmployeeId: productManager.id,
      brivoUserId: "brivo_u_alice_pm",
    },
    {
      email: "ben.design@wyze.com",
      name: "Ben Design",
      teamId: productTeam.id,
      managerEmployeeId: productManager.id,
      brivoUserId: "brivo_u_ben_design",
    },
    {
      email: "carol.research@wyze.com",
      name: "Carol Research",
      teamId: productTeam.id,
      managerEmployeeId: productManager.id,
      brivoUserId: "brivo_u_carol_research",
    },
    {
      email: "devon.backend@wyze.com",
      name: "Devon Backend",
      teamId: engineeringTeam.id,
      managerEmployeeId: engineeringManager.id,
      brivoUserId: "brivo_u_devon_backend",
    },
    {
      email: "fiona.frontend@wyze.com",
      name: "Fiona Frontend",
      teamId: engineeringTeam.id,
      managerEmployeeId: engineeringManager.id,
      brivoUserId: "brivo_u_fiona_frontend",
    },
    {
      email: "gabe.mobile@wyze.com",
      name: "Gabe Mobile",
      teamId: engineeringTeam.id,
      managerEmployeeId: engineeringManager.id,
      brivoUserId: "brivo_u_gabe_mobile",
    },
    {
      email: "hannah.cx@wyze.com",
      name: "Hannah CX",
      teamId: supportTeam.id,
      managerEmployeeId: supportManager.id,
      brivoUserId: "brivo_u_hannah_cx",
    },
    {
      email: "ivan.cx@wyze.com",
      name: "Ivan CX",
      teamId: supportTeam.id,
      managerEmployeeId: supportManager.id,
      brivoUserId: "brivo_u_ivan_cx",
    },
    {
      email: "jules.cx@wyze.com",
      name: "Jules CX",
      teamId: supportTeam.id,
      managerEmployeeId: supportManager.id,
      brivoUserId: "brivo_u_jules_cx",
    },
  ];

  for (const fixture of employeeFixtures) {
    await prisma.employee.create({
      data: {
        ...fixture,
        officeLocationId: office.id,
        status: EmployeeStatus.ACTIVE,
      },
    });
  }

  await prisma.appUser.createMany({
    data: [
      { email: "admin@wyze.com", role: Role.ADMIN },
      { email: "leader@wyze.com", role: Role.LEADER },
      { email: "manager.product@wyze.com", role: Role.MANAGER },
      { email: "manager.eng@wyze.com", role: Role.MANAGER },
      { email: "manager.cx@wyze.com", role: Role.MANAGER },
    ],
  });

  await prisma.holiday.createMany({
    data: [
      { name: "Christmas Day", date: new Date("2025-12-25T00:00:00.000Z") },
      { name: "New Year's Day", date: new Date("2026-01-01T00:00:00.000Z") },
      { name: "Memorial Day", date: new Date("2026-05-25T00:00:00.000Z") },
      { name: "Independence Day (Observed)", date: new Date("2026-07-03T00:00:00.000Z") },
      { name: "Thanksgiving", date: new Date("2026-11-26T00:00:00.000Z") },
      { name: "Day After Thanksgiving", date: new Date("2026-11-27T00:00:00.000Z") },
    ],
  });

  await prisma.appSetting.createMany({
    data: [
      {
        key: "entry_event_markers",
        valueJson: ["OPEN", "ACCESS_GRANTED", "DOOR_OPEN"],
      },
      {
        key: "allowlist_domains",
        valueJson: ["wyze.com"],
      },
    ],
  });

  const employees = await prisma.employee.findMany({
    include: { team: true },
    where: { status: EmployeeStatus.ACTIVE },
  });

  const holidaySet = new Set(
    (await prisma.holiday.findMany()).map((item) => ymd(item.date)),
  );

  const weekStart = startOfWeek(subWeeks(new Date(), 8), { weekStartsOn: 1 });
  const attendanceRows: Array<{
    employeeId: string;
    date: Date;
    firstSeenAt: Date;
    lastSeenAt: Date;
    present: boolean;
    officeLocationId: string;
    source: AttendanceSource;
  }> = [];

  const rawRows: Array<{
    brivoEventId: string;
    occurredAt: Date;
    brivoUserId: string;
    brivoDoorId: string;
    securityAction: string;
    eventType: string;
    payloadJson: object;
    ingestionMode: AttendanceSource;
  }> = [];

  for (let dayOffset = 0; dayOffset < 8 * 7 + 7; dayOffset += 1) {
    const date = addDays(weekStart, dayOffset);
    const weekday = WEEKDAY_BY_INDEX[date.getUTCDay()];

    if (weekday === Weekday.SAT || weekday === Weekday.SUN) {
      continue;
    }

    const dateKey = ymd(date);
    if (holidaySet.has(dateKey)) {
      continue;
    }

    for (const employee of employees) {
      const scheduled = employee.team.scheduleDays.includes(weekday);
      const attendanceProbability = scheduled ? 0.88 : 0.2;
      if (!shouldAttend(employee.email, dateKey, attendanceProbability)) {
        continue;
      }

      const firstMinuteOffset = stableHash(`${employee.email}:${dateKey}:first`) % 45;
      const durationMinutes = 360 + (stableHash(`${employee.email}:${dateKey}:duration`) % 180);

      const firstSeenAt = new Date(`${dateKey}T17:${String(firstMinuteOffset).padStart(2, "0")}:00.000Z`);
      const lastSeenAt = new Date(firstSeenAt.getTime() + durationMinutes * 60 * 1000);

      attendanceRows.push({
        employeeId: employee.id,
        date: new Date(`${dateKey}T00:00:00.000Z`),
        firstSeenAt,
        lastSeenAt,
        present: true,
        officeLocationId: office.id,
        source: AttendanceSource.MANUAL,
      });

      const selectedDoor = doors[stableHash(`${employee.email}:${dateKey}:door`) % doors.length];
      if (selectedDoor.brivoDoorId) {
        rawRows.push({
          brivoEventId: `seed-${employee.id}-${dateKey}-entry`,
          occurredAt: firstSeenAt,
          brivoUserId: employee.brivoUserId ?? `seed-${employee.id}`,
          brivoDoorId: selectedDoor.brivoDoorId,
          securityAction: "ACCESS_GRANTED",
          eventType: "OPEN",
          payloadJson: {
            source: "seed",
            email: employee.email,
            location: office.name,
            occurredAt: firstSeenAt.toISOString(),
          },
          ingestionMode: AttendanceSource.MANUAL,
        });
      }
    }
  }

  if (attendanceRows.length) {
    await prisma.attendanceDay.createMany({ data: attendanceRows });
  }

  if (rawRows.length) {
    await prisma.brivoEventRaw.createMany({ data: rawRows });
    const latestEvent = rawRows.reduce((latest, row) =>
      row.occurredAt > latest.occurredAt ? row : latest,
    );

    await prisma.ingestionCursor.upsert({
      where: { id: "default" },
      update: {
        lastOccurredAt: latestEvent.occurredAt,
        lastBrivoEventId: latestEvent.brivoEventId,
      },
      create: {
        id: "default",
        lastOccurredAt: latestEvent.occurredAt,
        lastBrivoEventId: latestEvent.brivoEventId,
      },
    });
  }

  console.log(`Seed complete. Employees: ${employees.length}, attendance rows: ${attendanceRows.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
