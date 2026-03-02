import { readLatestSnapshot } from "./storage";
import { refreshAndPersistReitSnapshot } from "./service";
import type { ReitDashboardSnapshot } from "./types";

function normalizeSnapshot(snapshot: ReitDashboardSnapshot): ReitDashboardSnapshot {
  const normalizeRecommendation = (item: ReitDashboardSnapshot["recommendations"][number]) => ({
    ...item,
    features: {
      ...item.features,
      dividendYieldPct: item.features?.dividendYieldPct ?? null,
    },
  });

  const rankedRaw =
    snapshot && Array.isArray((snapshot as Record<string, unknown>).ranked)
      ? ((snapshot as unknown as { ranked: ReitDashboardSnapshot["ranked"] }).ranked ?? [])
      : snapshot.recommendations;

  const ranked = rankedRaw.map(normalizeRecommendation);

  return {
    ...snapshot,
    ranked,
    recommendations: snapshot.recommendations.map(normalizeRecommendation),
    tail: snapshot.tail.map(normalizeRecommendation),
  };
}

export async function getReitSnapshot(options?: {
  forceRefreshIfMissing?: boolean;
}): Promise<ReitDashboardSnapshot | null> {
  const existing = await readLatestSnapshot();
  if (existing) return normalizeSnapshot(existing);

  if (!options?.forceRefreshIfMissing) {
    return null;
  }

  try {
    const result = await refreshAndPersistReitSnapshot();
    return normalizeSnapshot(result.snapshot);
  } catch {
    return null;
  }
}
