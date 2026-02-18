import Link from "next/link";
import { Role } from "@prisma/client";
import { requireUser } from "@/lib/auth/guards";
import { logoutAction } from "@/app/(protected)/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function canSeeLeader(role: Role) {
  return role === Role.ADMIN || role === Role.LEADER;
}

function canSeeAdmin(role: Role) {
  return role === Role.ADMIN;
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-background/90 backdrop-blur">
        <div className="container flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-display text-xl font-semibold">Wyze RTO Attendance</p>
            <p className="text-xs text-muted-foreground">Daily attendance + weekly compliance</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSeeLeader(user.role) ? (
              <Button asChild size="sm" variant="ghost">
                <Link href="/leader">Leader Dashboard</Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="ghost">
              <Link href="/manager">Manager Dashboard</Link>
            </Button>
            {canSeeAdmin(user.role) ? (
              <Button asChild size="sm" variant="ghost">
                <Link href="/admin">Admin Settings</Link>
              </Button>
            ) : null}
            <Badge variant="brand" className="ml-1 px-2 py-1 text-[10px]">
              {user.role}
            </Badge>
            <form action={logoutAction}>
              <Button size="sm" variant="outline" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="container py-6">{children}</main>
    </div>
  );
}
