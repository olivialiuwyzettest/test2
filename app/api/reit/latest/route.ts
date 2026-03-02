import { NextResponse } from "next/server";
import { getReitSnapshot } from "@/lib/reit/load";

export const runtime = "nodejs";

export async function GET() {
  const snapshot = await getReitSnapshot({ forceRefreshIfMissing: true });

  if (!snapshot) {
    return NextResponse.json({ ok: false, error: "No snapshot available" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, snapshot });
}
