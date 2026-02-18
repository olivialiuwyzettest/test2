import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";

export default async function HomePage() {
  const user = await requireUser();

  if (user.role === Role.MANAGER) {
    redirect("/manager");
  }

  redirect("/leader");
}
