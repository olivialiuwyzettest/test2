"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/server/db";
import { env } from "@/lib/env";
import {
  isAllowedEmailDomain,
  normalizeEmail,
  setSessionCookie,
} from "@/lib/auth/session";

export type LoginActionState = {
  error: string | null;
};

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const accessCode = String(formData.get("accessCode") ?? "").trim();

  if (!email || !accessCode) {
    return { error: "Email and access code are required." };
  }

  if (!isAllowedEmailDomain(email)) {
    return {
      error: `Email must use an approved domain (${env.allowedEmailDomains.join(", ")}).`,
    };
  }

  if (accessCode !== env.appSharedAccessCode) {
    return { error: "Access code is incorrect." };
  }

  const appUser = await db.appUser.findUnique({ where: { email } });
  if (!appUser) {
    return {
      error:
        "Your email is not in the access allowlist. Ask an admin to add your account.",
    };
  }

  const cookieStore = await cookies();
  setSessionCookie(cookieStore, email);
  redirect("/");
}
