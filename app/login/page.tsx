import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/guards";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/app/login/login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Wyze RTO Attendance</CardTitle>
          <CardDescription>
            Sign in with your Wyze email and internal access code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
          <p className="mt-4 text-xs text-muted-foreground">
            Access is limited to allowlisted roles in the internal user table.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
