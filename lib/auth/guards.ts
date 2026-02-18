import "server-only";
import { Role } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/session";
import { db } from "@/lib/server/db";

export type CurrentUser = {
  email: string;
  role: Role;
  employeeId: string | null;
  name: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session) {
    return null;
  }

  const [appUser, employee] = await Promise.all([
    db.appUser.findUnique({ where: { email: session.email } }),
    db.employee.findUnique({ where: { email: session.email } }),
  ]);

  if (!appUser) {
    return null;
  }

  return {
    email: session.email,
    role: appUser.role,
    employeeId: employee?.id ?? null,
    name: employee?.name ?? null,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireRole(roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    redirect("/unauthorized");
  }
  return user;
}

export function isRoleAtLeastLeader(role: Role): boolean {
  return role === Role.ADMIN || role === Role.LEADER;
}

export function isRoleAdmin(role: Role): boolean {
  return role === Role.ADMIN;
}
