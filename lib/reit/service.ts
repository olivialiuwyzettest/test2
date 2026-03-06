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
  const liveYieldCount = [...yields.values()].filter((value): value is number => value !== null).length;

  const recommendations: ReitRecommendation[] = universe.map((item) => {
    const seed = hashToUnit(`${asOfDate}-${item.ticker}`);
    const dip = Math.min(1, 0.35 + seed * 0.65);
    const trend = Math.min(1, 0.25 + hashToUnit(`trend-${asOfDate}-${item.ticker}`) * 0.75);
    const macroAlignment = Math.min(1, 0.3 + hashToUnit(`macro-${asOfDate}-${item.ticker}`) * 0.7);
    const confirmation = Math.min(1, 0.25 + hashToUnit(`confirm-${asOfDate}-${item.ticker}`) * 0.75);
    const yieldSupport = Math.min(1, 0.3 + hashToUnit(`yield-${asOfDate}-${item.ticker}`) * 0.7);
    const liquidity = Math.min(1, 0.4 + hashToUnit(`liq-${asOfDate}-${item.ticker}`) * 0.6);
    const aiStructural = Math.min(1, Math.max(0, (item.aiStructural + 1) / 2));
    const riskPenalty = Math.min(1, 0.72 + hashToUnit(`risk-${asOfDate}-${item.ticker}`) * 0.28);
    const lastClose = Number((65 + seed * 95).toFixed(2));
    const ret5dPct = Number((-4 + hashToUnit(`ret5-${asOfDate}-${item.ticker}`) * 10).toFixed(2));

    const score =
      100 *
      0.7 *
      (0.26 * dip +
        0.22 * trend +
        0.18 * macroAlignment +
        0.14 * confirmation +
        0.1 * yieldSupport +
        0.05 * aiStructural +
        0.05 * liquidity) *
      riskPenalty;
    const timingScore = Number((48 + confirmation * 42).toFixed(1));
    const conviction = Number((0.65 * score + 0.35 * timingScore).toFixed(1));
    const action =
      conviction >= 72
        ? "buy_now"
        : conviction >= 60
          ? "scale_in"
          : conviction >= 50
            ? "wait_for_confirmation"
            : "avoid";

    return {
      ticker: item.ticker,
      name: item.name,
      propertyType: item.propertyType,
      score: Number(score.toFixed(2)),
      rank: 0,
      action,
      conviction,
      timingScore,
      signal:
        action === "buy_now"
          ? "strong_buy"
          : action === "scale_in"
            ? "buy_dip"
            : action === "wait_for_confirmation"
              ? "watch"
              : "hold_back",
      decisionSummary:
        action === "buy_now"
          ? "Demo mode says the setup is ready enough for a starter position."
          : action === "scale_in"
            ? "Demo mode favors a staged entry rather than a full-size buy."
            : action === "wait_for_confirmation"
              ? "Demo mode keeps this on watch pending better confirmation."
              : "Demo mode says wait; too many blockers remain.",
      blockers:
        action === "avoid"
          ? ["Demo mode only: configure live APIs before acting on this setup."]
          : ["Demo mode only: macro and price inputs are simulated."],
      upgradeTriggers: [
        "Configure live APIs to replace demo-mode macro inputs.",
        "Wait for the next daily refresh before acting on a demo signal.",
      ],
      entryPlan: {
        starterSizePct: action === "buy_now" ? 35 : action === "scale_in" ? 20 : 0,
        maxSizePct:
          action === "buy_now" ? 100 : action === "scale_in" ? 75 : action === "wait_for_confirmation" ? 50 : 0,
        buyRule:
          action === "buy_now"
            ? `Demo: start near $${lastClose.toFixed(2)} with a 35% starter.`
            : action === "scale_in"
              ? `Demo: start small near $${lastClose.toFixed(2)} only if price holds steady.`
              : "Demo: do not buy yet.",
        addRule:
          action === "buy_now"
            ? "Demo: add on a stable retest or a higher close."
            : action === "scale_in"
              ? "Demo: add only after a positive 5-day trend."
              : "Demo: wait for confirmation before entering.",
        abortRule: `Demo: pause if price breaks below $${(lastClose * 0.96).toFixed(2)}.`,
      },
      rationale: ["Demo snapshot mode: configure API keys for live recommendations."],
      features: {
        lastClose,
        dd52wPct: Number((-35 + seed * 30).toFixed(2)),
        rsi14: Number((25 + seed * 45).toFixed(2)),
        ret5dPct,
        ret20dPct: Number((-12 + seed * 20).toFixed(2)),
        ret252dPct: Number((-8 + seed * 30).toFixed(2)),
        ma200DistancePct: Number((-10 + seed * 18).toFixed(2)),
        distanceFrom20dLowPct: Number((1 + seed * 7).toFixed(2)),
        distanceTo20dHighPct: Number((-9 + seed * 8).toFixed(2)),
        volatility20dPct: Number((1.4 + seed * 2.2).toFixed(2)),
        rateBeta: Number((0.2 + seed * 0.8).toFixed(3)),
        liqUsd20d: Math.round(1_500_000 + seed * 15_000_000),
        dividendYieldPct: yields.get(item.ticker) ?? null,
      },
      components: {
        dip: Number(dip.toFixed(4)),
        trend: Number(trend.toFixed(4)),
        macroAlignment: Number(macroAlignment.toFixed(4)),
        confirmation: Number(confirmation.toFixed(4)),
        yieldSupport: Number(yieldSupport.toFixed(4)),
        aiStructural: Number(aiStructural.toFixed(4)),
        liquidity: Number(liquidity.toFixed(4)),
        recessionTilt: 1,
        riskPenalty: Number(riskPenalty.toFixed(4)),
      },
    };
  });

  recommendations.sort((a, b) => {
    if (b.conviction !== a.conviction) return b.conviction - a.conviction;
    return b.score - a.score;
  });
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
        dip: 0.26,
        trend: 0.22,
        macroAlignment: 0.18,
        confirmation: 0.14,
        yieldSupport: 0.1,
        aiStructural: 0.05,
        liquidity: 0.05,
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
      cyclePhase: "transition",
      cycleScore: 58.4,
      macroSummary: "Mixed macro signals. Stay balanced and favor incremental positioning.",
      decisionPlaybook: [
        "Use partial entries and reassess after each major macro release.",
        "Prefer names where both macro alignment and trend score are positive.",
        "Avoid concentrating too heavily in one property type.",
      ],
      buyWindowStatus: "selective",
      buyWindowScore: 61.2,
      buyWindowSummary: "Demo macro says buy selectively, not aggressively.",
      pullTriggerChecklist: [
        "Only buy the cleanest setups in demo mode.",
        "Use staged entries instead of all-in orders.",
        "Switch to live macro data before relying on this signal.",
      ],
      keyReadings: [
        { key: "VIXCLS", label: "VIX", value: 18.4 },
        { key: "HY_OAS", label: "HY OAS", value: 375, unit: "bp" },
        { key: "DGS10", label: "10Y Yield", value: 4.1, unit: "%" },
      ],
      indicators: [
        {
          key: "VIXCLS",
          label: "VIX",
          value: 18.4,
          betterWhen: "lower",
          dod: -0.4,
          mom: -1.2,
          yoy: 1.1,
          dodPct: -2.13,
          momPct: -6.12,
          yoyPct: 6.36,
          status: "improving",
          reitImpact: "tailwind",
          interpretation: "Improving trend. Lower equity volatility usually supports risk appetite for REIT allocations.",
        },
        {
          key: "HY_OAS",
          label: "HY OAS",
          value: 375,
          unit: "bp",
          betterWhen: "lower",
          dod: -2,
          mom: -8,
          yoy: 24,
          dodPct: -0.53,
          momPct: -2.09,
          yoyPct: 6.84,
          status: "improving",
          reitImpact: "tailwind",
          interpretation: "Improving trend. Tighter credit spreads reduce refinancing stress for leveraged real estate.",
        },
        {
          key: "DGS10",
          label: "10Y Yield",
          value: 4.1,
          unit: "%",
          betterWhen: "lower",
          dod: 0.02,
          mom: 0.16,
          yoy: 0.34,
          dodPct: 0.49,
          momPct: 4.06,
          yoyPct: 9.04,
          status: "worsening",
          reitImpact: "headwind",
          interpretation: "Worsening trend. Lower long rates generally support REIT valuations and cap-rate spreads.",
        },
      ],
      msiHistory: Array.from({ length: 30 }).map((_, i) => ({
        date: new Date(asOf.getTime() - (29 - i) * 86_400_000).toISOString().slice(0, 10),
        msi: Number((0.5 - i * 0.004).toFixed(4)),
      })),
    },
    marketDecision: {
      status: "selective",
      score: 63.5,
      summary: "Demo market window is selective. Buy only the highest-conviction names and keep position sizes small.",
      pullTriggerRule: "In demo mode, act only on Buy Now or Scale In names with conviction above 70.",
      breadth: {
        oversoldPct: 42,
        positive5dPct: 38,
        positiveTrendPct: 46,
        buyNowCount: recommendations.filter((item) => item.action === "buy_now").length,
        scaleInCount: recommendations.filter((item) => item.action === "scale_in").length,
      },
      checklist: [
        "Treat demo output as a preview, not a trade instruction.",
        "Keep entries staged and small.",
        "Configure live APIs for real macro timing.",
      ],
    },
    ranked: recommendations,
    recommendations: recommendations.slice(0, 10),
    tail: recommendations.slice(-5),
    notes: [
      "Demo snapshot generated because live providers were unavailable.",
      `Dividend yields pulled from free providers for ${liveYieldCount}/${universe.length} tickers.`,
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
