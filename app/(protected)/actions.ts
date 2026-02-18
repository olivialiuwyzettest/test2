"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearSessionCookie } from "@/lib/auth/session";

export async function logoutAction() {
  const cookieStore = await cookies();
  clearSessionCookie(cookieStore);
  redirect("/login");
}
