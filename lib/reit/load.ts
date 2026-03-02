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

  const macroRaw = snapshot.macro as ReitDashboardSnapshot["macro"] & {
    indicators?: ReitDashboardSnapshot["macro"]["indicators"];
    cyclePhase?: ReitDashboardSnapshot["macro"]["cyclePhase"];
    cycleScore?: ReitDashboardSnapshot["macro"]["cycleScore"];
    macroSummary?: ReitDashboardSnapshot["macro"]["macroSummary"];
    decisionPlaybook?: ReitDashboardSnapshot["macro"]["decisionPlaybook"];
  };

  const fallbackIndicators =
    Array.isArray(macroRaw.keyReadings) && macroRaw.keyReadings.length
      ? macroRaw.keyReadings.map((reading) => ({
          key: reading.key,
          label: reading.label,
          value: reading.value,
          unit: reading.unit,
          betterWhen: "lower" as const,
          dod: null,
          mom: null,
          yoy: null,
          dodPct: null,
          momPct: null,
          yoyPct: null,
          status: "flat" as const,
          reitImpact: "neutral" as const,
          interpretation: "Historical delta unavailable for this stored snapshot.",
        }))
      : [];

  return {
    ...snapshot,
    macro: {
      ...snapshot.macro,
      cyclePhase: macroRaw.cyclePhase ?? "transition",
      cycleScore: macroRaw.cycleScore ?? 50,
      macroSummary: macroRaw.macroSummary ?? "Macro context unavailable for this stored snapshot.",
      decisionPlaybook: macroRaw.decisionPlaybook ?? [],
      indicators: Array.isArray(macroRaw.indicators) ? macroRaw.indicators : fallbackIndicators,
    },
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
