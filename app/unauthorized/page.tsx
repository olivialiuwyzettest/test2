import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>
            Your account is signed in but does not have permission for this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button asChild variant="secondary">
            <Link href="/">Back to Dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Sign in with another account</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
