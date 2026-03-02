import { NextResponse } from "next/server";
import { refreshAndPersistReitSnapshot } from "@/lib/reit/service";

export const runtime = "nodejs";

function getCronSecret(): string | null {
  return process.env.REIT_CRON_SECRET ?? null;
}

function authorized(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return true;

  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret");

  return provided === secret;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshAndPersistReitSnapshot();
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      asOf: result.snapshot.asOf,
      topTicker: result.snapshot.recommendations[0]?.ticker ?? null,
      topScore: result.snapshot.recommendations[0]?.score ?? null,
      warning: result.message ?? null,
      generatedAt: result.snapshot.generatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Refresh failed",
      },
      { status: 500 },
    );
  }
}
