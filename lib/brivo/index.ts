import { env } from "@/lib/env";
import { BrivoLiveAdapter } from "@/lib/brivo/live-adapter";
import { BrivoMockAdapter } from "@/lib/brivo/mock-adapter";
import type { BrivoAdapter } from "@/lib/brivo/types";

let adapter: BrivoAdapter | null = null;

export function getBrivoAdapter(): BrivoAdapter {
  if (adapter) {
    return adapter;
  }

  adapter = env.brivoMode === "live" ? new BrivoLiveAdapter() : new BrivoMockAdapter();
  return adapter;
}
