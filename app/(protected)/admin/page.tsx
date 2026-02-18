import { Role } from "@prisma/client";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth/guards";
import {
  listDoorsWithLocation,
  listEmployeeMappings,
  listHolidays,
  listTeamSchedules,
} from "@/lib/attendance/compliance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminForms } from "@/app/(protected)/admin/admin-forms";

function buildDefaultWebhookUrl(host: string | null, proto: string | null): string {
  if (!host) {
    return "https://example.internal/api/brivo/webhook";
  }

  const protocol = proto === "http" || proto === "https" ? proto : "https";
  return `${protocol}://${host}/api/brivo/webhook`;
}

export default async function AdminPage() {
  await requireRole([Role.ADMIN]);

  const [teams, doors, holidays, mappings, headerStore] = await Promise.all([
    listTeamSchedules(),
    listDoorsWithLocation(),
    listHolidays(),
    listEmployeeMappings(),
    headers(),
  ]);

  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto");

  const mappedEmployees = mappings.filter((employee) => Boolean(employee.brivoUserId)).length;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Admin Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure attendance policy, holiday calendars, Brivo mappings, and ingestion controls.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>MVP Guardrails</CardTitle>
          <CardDescription>
            Default view is aggregate-only. Raw Brivo events are only shown on employee detail for admins.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use team schedule settings and holiday imports to mirror Wyze’s real policy calendar (Amazon-like calendar, Presidents’ Day excluded unless explicitly added).
        </CardContent>
      </Card>

      <AdminForms
        teams={teams}
        doors={doors}
        holidays={holidays}
        mappingCount={mappedEmployees}
        defaultCallbackUrl={buildDefaultWebhookUrl(host, proto)}
      />
    </div>
  );
}
