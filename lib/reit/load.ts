import { readLatestSnapshot } from "./storage";
import { refreshAndPersistReitSnapshot } from "./service";
import type { ReitDashboardSnapshot } from "./types";

export async function getReitSnapshot(options?: {
  forceRefreshIfMissing?: boolean;
}): Promise<ReitDashboardSnapshot | null> {
  const existing = await readLatestSnapshot();
  if (existing) return existing;

  if (!options?.forceRefreshIfMissing) {
    return null;
  }

  try {
    const result = await refreshAndPersistReitSnapshot();
    return result.snapshot;
  } catch {
    return null;
  }
}
