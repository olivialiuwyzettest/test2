"use server";

import { Role, Weekday } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  createOrRefreshBrivoSubscription,
  runPollingSync,
} from "@/lib/attendance/ingestion";
import {
  importBrivoMappings,
  importHolidays,
  importRosterCsv,
} from "@/lib/attendance/importers";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/server/db";
import { env } from "@/lib/env";

export type AdminActionState = {
  ok: boolean;
  message: string;
};

const initialSuccess: AdminActionState = {
  ok: true,
  message: "",
};

function buildError(message: string): AdminActionState {
  return { ok: false, message };
}

async function readImportPayload(formData: FormData, textFieldName: string, fileFieldName: string) {
  const inlineValue = String(formData.get(textFieldName) ?? "").trim();
  if (inlineValue) return inlineValue;

  const file = formData.get(fileFieldName);
  if (file instanceof File) {
    const text = await file.text();
    return text.trim();
  }

  return "";
}

function parseWeekdayTokens(values: string[]): Weekday[] {
  const mapped = values
    .map((value) => value.toUpperCase())
    .filter((value): value is Weekday =>
      ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].includes(value),
    );
  return Array.from(new Set(mapped));
}

export async function updateTeamPolicyAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await requireRole([Role.ADMIN]);

    const teamId = String(formData.get("teamId") ?? "");
    const requiredDaysPerWeek = Number.parseInt(String(formData.get("requiredDaysPerWeek") ?? "3"), 10);
    const scheduleDays = parseWeekdayTokens(formData.getAll("scheduleDays").map(String));

    if (!teamId || !scheduleDays.length) {
      return buildError("Team and schedule days are required.");
    }

    await db.team.update({
      where: { id: teamId },
      data: {
        requiredDaysPerWeek: Number.isFinite(requiredDaysPerWeek) ? requiredDaysPerWeek : 3,
        scheduleDays,
      },
    });

    revalidatePath("/admin");
    revalidatePath("/leader");
    revalidatePath("/manager");
    return {
      ok: true,
      message: "Team schedule updated.",
    };
  } catch (error) {
    return buildError(error instanceof Error ? error.message : "Failed to update team schedule.");
  }
}

export async function updateDoorAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await requireRole([Role.ADMIN]);

    const doorId = String(formData.get("doorId") ?? "");
    const countsForEntry = String(formData.get("countsForEntry") ?? "") === "on";

    if (!doorId) {
      return buildError("Door id is required.");
    }

    await db.door.update({
      where: { id: doorId },
      data: { countsForEntry },
    });

    revalidatePath("/admin");
    return {
      ok: true,
      message: "Door entry setting updated.",
    };
  } catch (error) {
    return buildError(error instanceof Error ? error.message : "Failed to update door.");
  }
}

export async function importRosterAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await requireRole([Role.ADMIN]);
    const payload = await readImportPayload(formData, "rosterText", "rosterFile");
    if (!payload) {
      return buildError("Provide roster CSV content or upload a CSV file.");
    }

    const summary = await importRosterCsv(payload);
    revalidatePath("/admin");
    revalidatePath("/leader");
    revalidatePath("/manager");
    return {
      ok: true,
      message: `Roster imported: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
    };
  } catch (error) {
    return buildError(error instanceof Error ? error.message : "Roster import failed.");
  }
}

export async function importHolidaysAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await requireRole([Role.ADMIN]);
    const payload = await readImportPayload(formData, "holidayText", "holidayFile");
    if (!payload) {
      return buildError("Provide holiday CSV/JSON content or upload a file.");
    }

    const summary = await importHolidays(payload);
    revalidatePath("/admin");
    revalidatePath("/leader");
    revalidatePath("/manager");

    return {
      ok: true,
      message: `Holidays imported: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped.`,
    };
  } catch (error) {
    return buildError(error instanceof Error ? error.message : "Holiday import failed.");
  }
}

export async function importMappingsAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await requireRole([Role.ADMIN]);
    const payload = await readImportPayload(formData, "mappingText", "mappingFile");
    if (!payload) {
      return buildError("Provide mapping CSV content or upload a file.");
    }

    const summary = await importBrivoMappings(payload);
    revalidatePath("/admin");
    revalidatePath("/manager");
    return {
      ok: true,
      message: `Mappings imported: ${summary.updated} updated, ${summary.skipped} skipped.`,
    };
  } catch (error) {
    return buildError(error instanceof Error ? error.message : "Mapping import failed.");
  }
}

export async function runSyncNowAction(): Promise<AdminActionState> {
  try {
    await requireRole([Role.ADMIN]);
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const summary = await runPollingSync({ from: yesterday, to: now });

    revalidatePath("/admin");
    revalidatePath("/leader");
    revalidatePath("/manager");

    return {
      ok: true,
      message: `Sync complete (${summary.mode}). ${summary.insertedRawEvents} new events, ${summary.attendanceDaysTouched} attendance days updated.`,
    };
  } catch (error) {
    return buildError(error instanceof Error ? error.message : "Sync failed.");
  }
}

export async function refreshSubscriptionAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await requireRole([Role.ADMIN]);
    const callbackUrl = String(formData.get("callbackUrl") ?? "").trim();
    if (!callbackUrl) {
      return buildError("Webhook callback URL is required.");
    }

    const result = await createOrRefreshBrivoSubscription({
      callbackUrl,
      secret: env.brivoWebhookSecret,
    });

    revalidatePath("/admin");
    return {
      ok: true,
      message: `Subscription refreshed (${result.status}) with ID ${result.subscriptionId}.`,
    };
  } catch (error) {
    return buildError(error instanceof Error ? error.message : "Subscription refresh failed.");
  }
}

export { initialSuccess };
