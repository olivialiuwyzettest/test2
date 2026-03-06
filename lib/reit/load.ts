import { readLatestSnapshot } from "./storage";
import { refreshAndPersistReitSnapshot } from "./service";
import type { ReitDashboardSnapshot } from "./types";

function normalizeSnapshot(snapshot: ReitDashboardSnapshot): ReitDashboardSnapshot {
  const normalizeRecommendation = (item: ReitDashboardSnapshot["recommendations"][number]) => ({
    ...item,
    action: item.action ?? "wait_for_confirmation",
    conviction: item.conviction ?? item.score,
    timingScore: item.timingScore ?? item.score,
    decisionSummary: item.decisionSummary ?? "Decision summary unavailable for this stored snapshot.",
    blockers: Array.isArray(item.blockers) ? item.blockers : [],
    upgradeTriggers: Array.isArray(item.upgradeTriggers) ? item.upgradeTriggers : [],
    entryPlan: item.entryPlan ?? {
      starterSizePct: 0,
      maxSizePct: 0,
      buyRule: "Entry plan unavailable for this stored snapshot.",
      addRule: "Entry plan unavailable for this stored snapshot.",
      abortRule: "Entry plan unavailable for this stored snapshot.",
    },
    features: {
      lastClose: item.features?.lastClose ?? 0,
      ...item.features,
      ret5dPct: item.features?.ret5dPct ?? 0,
      ma200DistancePct: item.features?.ma200DistancePct ?? 0,
      distanceFrom20dLowPct: item.features?.distanceFrom20dLowPct ?? 0,
      distanceTo20dHighPct: item.features?.distanceTo20dHighPct ?? 0,
      volatility20dPct: item.features?.volatility20dPct ?? 0,
      dividendYieldPct: item.features?.dividendYieldPct ?? null,
    },
    components: {
      confirmation: item.components?.confirmation ?? 0.5,
      yieldSupport: item.components?.yieldSupport ?? 0.5,
      riskPenalty: item.components?.riskPenalty ?? 1,
      ...item.components,
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
    buyWindowStatus?: ReitDashboardSnapshot["macro"]["buyWindowStatus"];
    buyWindowScore?: ReitDashboardSnapshot["macro"]["buyWindowScore"];
    buyWindowSummary?: ReitDashboardSnapshot["macro"]["buyWindowSummary"];
    pullTriggerChecklist?: ReitDashboardSnapshot["macro"]["pullTriggerChecklist"];
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
      buyWindowStatus: macroRaw.buyWindowStatus ?? "selective",
      buyWindowScore: macroRaw.buyWindowScore ?? 50,
      buyWindowSummary: macroRaw.buyWindowSummary ?? "Macro buy-window context unavailable for this stored snapshot.",
      pullTriggerChecklist: macroRaw.pullTriggerChecklist ?? [],
      indicators: Array.isArray(macroRaw.indicators) ? macroRaw.indicators : fallbackIndicators,
    },
    marketDecision: snapshot.marketDecision ?? {
      status: macroRaw.buyWindowStatus ?? "selective",
      score: macroRaw.buyWindowScore ?? 50,
      summary: macroRaw.buyWindowSummary ?? "Market decision context unavailable for this stored snapshot.",
      pullTriggerRule: "Use the latest refreshed snapshot for a full pull-trigger rule.",
      breadth: {
        oversoldPct: 0,
        positive5dPct: 0,
        positiveTrendPct: 0,
        buyNowCount: 0,
        scaleInCount: 0,
      },
      checklist: [],
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
