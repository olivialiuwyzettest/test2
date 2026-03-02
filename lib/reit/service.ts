import { getBaseUniverse } from "./config";
import { fetchDividendYields } from "./data";
import { buildReitSnapshot } from "./engine";
import { persistSnapshot, readLatestSnapshot } from "./storage";
import type { ReitDashboardSnapshot, ReitRecommendation } from "./types";

function hashToUnit(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return (hash % 10_000) / 10_000;
}

async function buildDemoSnapshot(asOf: Date): Promise<ReitDashboardSnapshot> {
  const asOfDate = asOf.toISOString().slice(0, 10);
  const generatedAt = new Date().toISOString();
  const universe = getBaseUniverse().slice(0, 20);
  const yields = await fetchDividendYields(universe.map((item) => item.ticker)).catch(() => new Map());

  const recommendations: ReitRecommendation[] = universe.map((item) => {
    const seed = hashToUnit(`${asOfDate}-${item.ticker}`);
    const dip = Math.min(1, 0.35 + seed * 0.65);
    const trend = Math.min(1, 0.25 + hashToUnit(`trend-${asOfDate}-${item.ticker}`) * 0.75);
    const macroAlignment = Math.min(1, 0.3 + hashToUnit(`macro-${asOfDate}-${item.ticker}`) * 0.7);
    const liquidity = Math.min(1, 0.4 + hashToUnit(`liq-${asOfDate}-${item.ticker}`) * 0.6);
    const aiStructural = Math.min(1, Math.max(0, (item.aiStructural + 1) / 2));

    const score =
      100 *
      0.7 *
      (0.35 * dip + 0.25 * trend + 0.2 * macroAlignment + 0.1 * aiStructural + 0.1 * liquidity);

    return {
      ticker: item.ticker,
      name: item.name,
      propertyType: item.propertyType,
      score: Number(score.toFixed(2)),
      rank: 0,
      signal: score >= 70 ? "strong_buy" : score >= 55 ? "buy_dip" : score >= 45 ? "watch" : "hold_back",
      rationale: ["Demo snapshot mode: configure API keys for live recommendations."],
      features: {
        dd52wPct: Number((-35 + seed * 30).toFixed(2)),
        rsi14: Number((25 + seed * 45).toFixed(2)),
        ret20dPct: Number((-12 + seed * 20).toFixed(2)),
        ret252dPct: Number((-8 + seed * 30).toFixed(2)),
        rateBeta: Number((0.2 + seed * 0.8).toFixed(3)),
        liqUsd20d: Math.round(1_500_000 + seed * 15_000_000),
        dividendYieldPct:
          yields.get(item.ticker) ?? Number((2.2 + seed * 4.3).toFixed(2)),
      },
      components: {
        dip: Number(dip.toFixed(4)),
        trend: Number(trend.toFixed(4)),
        macroAlignment: Number(macroAlignment.toFixed(4)),
        aiStructural: Number(aiStructural.toFixed(4)),
        liquidity: Number(liquidity.toFixed(4)),
        recessionTilt: 1,
      },
    };
  });

  recommendations.sort((a, b) => b.score - a.score);
  recommendations.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    generatedAt,
    asOf: asOfDate,
    universeSize: universe.length,
    scoredUniverseSize: universe.length,
    topN: 10,
    parameters: {
      liquidityFloorUsd: 1_500_000,
      stressLookbackDays: 1_200,
      scoreWeights: {
        dip: 0.35,
        trend: 0.25,
        macroAlignment: 0.2,
        aiStructural: 0.1,
        liquidity: 0.1,
      },
    },
    macro: {
      asOf: asOfDate,
      msi: 0.35,
      msiLevel: 0.72,
      msiTrend5d: -0.14,
      riskGate: 0.7,
      regime: "neutral",
      recessionRisk: 0.43,
      ratePressure: 0.18,
      creditStress: 0.26,
      oilShock: 0.31,
      fundingStress: 0.22,
      putCallZ: 0.15,
      keyReadings: [
        { key: "VIXCLS", label: "VIX", value: 18.4 },
        { key: "HY_OAS", label: "HY OAS", value: 375, unit: "bp" },
        { key: "DGS10", label: "10Y Yield", value: 4.1, unit: "%" },
      ],
      msiHistory: Array.from({ length: 30 }).map((_, i) => ({
        date: new Date(asOf.getTime() - (29 - i) * 86_400_000).toISOString().slice(0, 10),
        msi: Number((0.5 - i * 0.004).toFixed(4)),
      })),
    },
    ranked: recommendations,
    recommendations: recommendations.slice(0, 10),
    tail: recommendations.slice(-5),
    notes: [
      "Demo snapshot generated because live providers were unavailable.",
      "Dividend yields are pulled from Stooq; macro + scores remain demo until FRED_API_KEY is set.",
      "Set FRED_API_KEY and run refresh again to switch to live macro + price data.",
    ],
  };
}

export async function refreshAndPersistReitSnapshot(options?: {
  asOf?: Date;
  allowDemoFallback?: boolean;
}): Promise<{ snapshot: ReitDashboardSnapshot; mode: "live" | "cached" | "demo"; message?: string }> {
  const asOf = options?.asOf ?? new Date();
  const allowDemoFallback = options?.allowDemoFallback ?? true;

  try {
    const snapshot = await buildReitSnapshot(asOf);
    await persistSnapshot(snapshot);
    return { snapshot, mode: "live" };
  } catch (error) {
    const existing = await readLatestSnapshot();
    if (existing) {
      return {
        snapshot: existing,
        mode: "cached",
        message: error instanceof Error ? error.message : "Refresh failed",
      };
    }

    if (!allowDemoFallback) {
      throw error;
    }

    const demo = await buildDemoSnapshot(asOf);
    await persistSnapshot(demo);

    return {
      snapshot: demo,
      mode: "demo",
      message: error instanceof Error ? error.message : "Refresh failed",
    };
  }
}
