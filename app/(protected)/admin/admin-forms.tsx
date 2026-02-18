"use client";

import { Weekday } from "@prisma/client";
import { useActionState } from "react";
import {
  importHolidaysAction,
  importMappingsAction,
  importRosterAction,
  initialSuccess,
  refreshSubscriptionAction,
  runSyncNowAction,
  updateDoorAction,
  updateTeamPolicyAction,
  type AdminActionState,
} from "@/app/(protected)/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const WEEKDAY_OPTIONS: Weekday[] = [
  Weekday.MON,
  Weekday.TUE,
  Weekday.WED,
  Weekday.THU,
  Weekday.FRI,
];

function ActionMessage({ state }: { state: AdminActionState }) {
  if (!state.message) return null;
  return (
    <p
      className={
        state.ok
          ? "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700"
          : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      }
    >
      {state.message}
    </p>
  );
}

function TeamPolicyForm({
  team,
}: {
  team: {
    id: string;
    name: string;
    scheduleDays: Weekday[];
    requiredDaysPerWeek: number;
    employees: { id: string }[];
  };
}) {
  const [state, formAction, pending] = useActionState(updateTeamPolicyAction, initialSuccess);

  return (
    <form action={formAction} className="rounded-md border p-3">
      <input type="hidden" name="teamId" value={team.id} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{team.name}</p>
          <p className="text-xs text-muted-foreground">{team.employees.length} active employees</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Required days</label>
          <Input
            name="requiredDaysPerWeek"
            type="number"
            min={0}
            max={5}
            defaultValue={team.requiredDaysPerWeek}
            className="h-8 w-20"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {WEEKDAY_OPTIONS.map((weekday) => (
          <label key={weekday} className="inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              name="scheduleDays"
              value={weekday}
              defaultChecked={team.scheduleDays.includes(weekday)}
            />
            {weekday}
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function DoorToggleForm({
  door,
}: {
  door: {
    id: string;
    name: string;
    countsForEntry: boolean;
    officeLocation: { name: string };
  };
}) {
  const [state, formAction, pending] = useActionState(updateDoorAction, initialSuccess);

  return (
    <form action={formAction} className="rounded-md border p-3">
      <input type="hidden" name="doorId" value={door.id} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{door.name}</p>
          <p className="text-xs text-muted-foreground">{door.officeLocation.name}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="countsForEntry" defaultChecked={door.countsForEntry} />
          Counts for entry
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function RosterImportForm() {
  const [state, formAction, pending] = useActionState(importRosterAction, initialSuccess);

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <Textarea
        name="rosterText"
        placeholder="Paste roster CSV (email,name,team,managerEmail,status,brivoUserId,officeLocation)."
      />
      <Input name="rosterFile" type="file" accept=".csv,text/csv" />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Importing..." : "Import roster"}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function HolidayImportForm() {
  const [state, formAction, pending] = useActionState(importHolidaysAction, initialSuccess);

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <Textarea
        name="holidayText"
        placeholder='Paste holiday CSV/JSON. Example CSV: date,name,officeLocation or JSON: [{"date":"2026-11-26","name":"Thanksgiving"}]'
      />
      <Input name="holidayFile" type="file" accept=".csv,.json,text/csv,application/json" />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Importing..." : "Import holidays"}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function MappingImportForm() {
  const [state, formAction, pending] = useActionState(importMappingsAction, initialSuccess);

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <Textarea
        name="mappingText"
        placeholder="Paste mapping CSV: employeeEmail,brivoUserId"
      />
      <Input name="mappingFile" type="file" accept=".csv,text/csv" />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Importing..." : "Import mappings"}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function SyncNowForm() {
  const [state, formAction, pending] = useActionState(runSyncNowAction, initialSuccess);

  return (
    <form action={formAction} className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Polling Sync</p>
          <p className="text-xs text-muted-foreground">
            Pull Brivo events for yesterday through now and recompute attendance.
          </p>
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Running..." : "Sync Now"}
        </Button>
      </div>
      <div className="mt-2">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function SubscriptionForm({ defaultCallbackUrl }: { defaultCallbackUrl: string }) {
  const [state, formAction, pending] = useActionState(refreshSubscriptionAction, initialSuccess);

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Webhook callback URL
        </label>
        <Input name="callbackUrl" defaultValue={defaultCallbackUrl} required />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Refreshing..." : "Create / Refresh Subscription"}
        </Button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

export function AdminForms({
  teams,
  doors,
  holidays,
  mappingCount,
  defaultCallbackUrl,
}: {
  teams: Array<{
    id: string;
    name: string;
    scheduleDays: Weekday[];
    requiredDaysPerWeek: number;
    employees: { id: string }[];
  }>;
  doors: Array<{
    id: string;
    name: string;
    countsForEntry: boolean;
    officeLocation: { name: string };
  }>;
  holidays: Array<{
    id: string;
    date: Date;
    name: string;
    officeLocation: { name: string } | null;
  }>;
  mappingCount: number;
  defaultCallbackUrl: string;
}) {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SyncNowForm />
        <SubscriptionForm defaultCallbackUrl={defaultCallbackUrl} />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Team Schedules</h2>
          {teams.map((team) => (
            <TeamPolicyForm key={team.id} team={team} />
          ))}
        </div>

        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Door Entry Rules</h2>
          {doors.map((door) => (
            <DoorToggleForm key={door.id} door={door} />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div>
          <h2 className="mb-2 font-display text-lg font-semibold">Roster Import</h2>
          <RosterImportForm />
        </div>
        <div>
          <h2 className="mb-2 font-display text-lg font-semibold">Holiday Import</h2>
          <HolidayImportForm />
        </div>
        <div>
          <h2 className="mb-2 font-display text-lg font-semibold">Brivo Mapping Import</h2>
          <MappingImportForm />
          <p className="mt-2 text-xs text-muted-foreground">
            Currently mapped employees: <Badge variant="neutral">{mappingCount}</Badge>
          </p>
        </div>
      </section>

      <section className="rounded-md border p-3">
        <h2 className="font-display text-lg font-semibold">Configured Holidays</h2>
        <p className="text-xs text-muted-foreground">
          Holidays are custom to Wyze policy and can differ from federal holidays.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {holidays.map((holiday) => (
            <Badge key={holiday.id} variant="outline">
              {holiday.date.toISOString().slice(0, 10)} {holiday.name}
              {holiday.officeLocation ? ` (${holiday.officeLocation.name})` : " (Global)"}
            </Badge>
          ))}
        </div>
      </section>
    </div>
  );
}
