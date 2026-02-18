import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ingestWebhookPayload } from "@/lib/attendance/ingestion";

export async function POST(request: Request) {
  try {
    if (env.brivoWebhookSecret) {
      const providedSecret =
        request.headers.get("x-brivo-signature") ??
        request.headers.get("x-brivo-secret") ??
        request.headers.get("authorization");

      if (!providedSecret || !providedSecret.includes(env.brivoWebhookSecret)) {
        return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
      }
    }

    const payload = await request.json();
    const result = await ingestWebhookPayload(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Webhook processing failed",
      },
      { status: 500 },
    );
  }
}
