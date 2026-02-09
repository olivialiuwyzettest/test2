import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { runScanNow } from "@/lib/scanner/runScan";

export async function POST() {
  try {
    const result = await runScanNow(prisma);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("Scan API failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

