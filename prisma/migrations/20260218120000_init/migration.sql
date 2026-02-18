-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('ADMIN', 'LEADER', 'MANAGER');

-- CreateEnum
CREATE TYPE "public"."Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "public"."EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."AttendanceSource" AS ENUM ('POLLING', 'WEBHOOK', 'MANUAL');

-- CreateTable
CREATE TABLE "public"."AppUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scheduleDays" "public"."Weekday"[],
    "requiredDaysPerWeek" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OfficeLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "brivoSiteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Employee" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "managerEmployeeId" TEXT,
    "officeLocationId" TEXT,
    "status" "public"."EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "brivoUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Door" (
    "id" TEXT NOT NULL,
    "officeLocationId" TEXT NOT NULL,
    "brivoDoorId" TEXT,
    "name" TEXT NOT NULL,
    "countsForEntry" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Door_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "officeLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BrivoEventRaw" (
    "id" TEXT NOT NULL,
    "brivoEventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "brivoUserId" TEXT,
    "brivoDoorId" TEXT,
    "securityAction" TEXT,
    "eventType" TEXT,
    "payloadJson" JSONB NOT NULL,
    "ingestionMode" "public"."AttendanceSource" NOT NULL DEFAULT 'POLLING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrivoEventRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AttendanceDay" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "present" BOOLEAN NOT NULL DEFAULT false,
    "officeLocationId" TEXT,
    "source" "public"."AttendanceSource" NOT NULL DEFAULT 'POLLING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IngestionCursor" (
    "id" TEXT NOT NULL,
    "lastOccurredAt" TIMESTAMP(3),
    "lastBrivoEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AppSetting" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_email_key" ON "public"."AppUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "public"."Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeLocation_name_key" ON "public"."OfficeLocation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeLocation_brivoSiteId_key" ON "public"."OfficeLocation"("brivoSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "public"."Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_brivoUserId_key" ON "public"."Employee"("brivoUserId");

-- CreateIndex
CREATE INDEX "Employee_teamId_idx" ON "public"."Employee"("teamId");

-- CreateIndex
CREATE INDEX "Employee_managerEmployeeId_idx" ON "public"."Employee"("managerEmployeeId");

-- CreateIndex
CREATE INDEX "Employee_officeLocationId_idx" ON "public"."Employee"("officeLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Door_brivoDoorId_key" ON "public"."Door"("brivoDoorId");

-- CreateIndex
CREATE INDEX "Door_officeLocationId_idx" ON "public"."Door"("officeLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Door_officeLocationId_name_key" ON "public"."Door"("officeLocationId", "name");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "public"."Holiday"("date");

-- CreateIndex
CREATE INDEX "Holiday_officeLocationId_idx" ON "public"."Holiday"("officeLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_name_officeLocationId_key" ON "public"."Holiday"("date", "name", "officeLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "BrivoEventRaw_brivoEventId_key" ON "public"."BrivoEventRaw"("brivoEventId");

-- CreateIndex
CREATE INDEX "BrivoEventRaw_occurredAt_idx" ON "public"."BrivoEventRaw"("occurredAt");

-- CreateIndex
CREATE INDEX "BrivoEventRaw_brivoUserId_idx" ON "public"."BrivoEventRaw"("brivoUserId");

-- CreateIndex
CREATE INDEX "BrivoEventRaw_brivoDoorId_idx" ON "public"."BrivoEventRaw"("brivoDoorId");

-- CreateIndex
CREATE INDEX "AttendanceDay_date_idx" ON "public"."AttendanceDay"("date");

-- CreateIndex
CREATE INDEX "AttendanceDay_officeLocationId_idx" ON "public"."AttendanceDay"("officeLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_employeeId_date_key" ON "public"."AttendanceDay"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_officeLocationId_fkey" FOREIGN KEY ("officeLocationId") REFERENCES "public"."OfficeLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Door" ADD CONSTRAINT "Door_officeLocationId_fkey" FOREIGN KEY ("officeLocationId") REFERENCES "public"."OfficeLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Holiday" ADD CONSTRAINT "Holiday_officeLocationId_fkey" FOREIGN KEY ("officeLocationId") REFERENCES "public"."OfficeLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AttendanceDay" ADD CONSTRAINT "AttendanceDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AttendanceDay" ADD CONSTRAINT "AttendanceDay_officeLocationId_fkey" FOREIGN KEY ("officeLocationId") REFERENCES "public"."OfficeLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

