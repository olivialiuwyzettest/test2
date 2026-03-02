import { format } from "date-fns";
import {
  CYCLICAL_PROPERTY_TYPES,
  DEFENSIVE_PROPERTY_TYPES,
  REIT_SCORE_WEIGHTS,
  aiScoreToUnit,
} from "./config";
import {
  fetchMacroInputs,
  fetchTickerPriceHistory,
  loadReitUniverse,
  mapWithConcurrency,
} from "./data";
import {
  clamp,
  linearRegressionBeta,
  mean,
  percentile,
  rollingMean,
  rollingMedian,
  round,
  safeDivide,
  scoreByRank,
  sigmoid,
  stdDev,
} from "./math";
import type {
  MacroInputs,
  MacroSeriesPoint,
  MacroSnapshot,
  PriceBar,
  PropertyType,
  ReitComputedFeatures,
  ReitDashboardSnapshot,
  ReitRecommendation,
  ReitUniverseItem,
} from "./types";

type MacroDerived = {
  snapshot: MacroSnapshot;
  latestRatePressure: number;
  latestRecessionRisk: number;
  latestRiskGate: number;
};

const DEFAULT_LOOKBACK_DAYS = 1_200;
const DEFAULT_TOP_N = 12;
const DEFAULT_LIQUIDITY_FLOOR_USD = 1_500_000;

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function sortedPoints(points: MacroSeriesPoint[]): MacroSeriesPoint[] {
  return [...points].sort((a, b) => a.date.localeCompare(b.date));
}

function buildCalendar(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function alignSeries(points: MacroSeriesPoint[], dates: string[]): number[] {
  const sorted = sortedPoints(points);
  const values: number[] = [];

  let idx = 0;
  let last = Number.NaN;

  for (const date of dates) {
    while (idx < sorted.length && sorted[idx]!.date <= date) {
      last = sorted[idx]!.value;
      idx += 1;
    }

    values.push(last);
  }

  return values;
}

function diff(values: number[], lag: number): number[] {
  return values.map((value, index) => {
    if (!Number.isFinite(value) || index < lag || !Number.isFinite(values[index - lag]!)) {
      return Number.NaN;
    }
    return value - values[index - lag]!;
  });
}

function zNormalize(values: number[]): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) {
    return values.map(() => 0);
  }

  const mu = mean(finite);
  const sigma = stdDev(finite);
  if (sigma === 0) {
    return values.map((v) => (Number.isFinite(v) ? 0 : Number.NaN));
  }

  return values.map((v) => (Number.isFinite(v) ? (v - mu) / sigma : Number.NaN));
}

function add(...series: number[][]): number[] {
  const length = series[0]?.length ?? 0;
  const result = new Array<number>(length).fill(0);

  for (let i = 0; i < length; i += 1) {
    let value = 0;
    for (const current of series) {
      const point = current[i];
      if (Number.isFinite(point)) {
        value += point!;
      }
    }
    result[i] = value;
  }

  return result;
}

function scale(series: number[], factor: number): number[] {
  return series.map((value) => (Number.isFinite(value) ? value * factor : Number.NaN));
}

function latestFinite(series: number[]): number {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (Number.isFinite(value)) return value!;
  }
  return 0;
}

function latestRaw(points: MacroSeriesPoint[]): number {
  if (!points.length) return 0;
  return points[points.length - 1]!.value;
}

function computeMacroDerived(macro: MacroInputs, asOfDate: string): MacroDerived {
  const allDates = [
    ...macro.vix,
    ...macro.vxv,
    ...macro.hyOas,
    ...macro.igOas,
    ...macro.dgs10,
    ...macro.dfii10,
    ...macro.t10y3m,
    ...macro.usdBroad,
    ...macro.oilWti,
    ...macro.ovx,
    ...macro.sofr,
    ...macro.claims,
    ...macro.sahm,
    ...macro.recProb,
    ...macro.putCall,
  ]
    .map((point) => point.date)
    .filter((date) => date <= asOfDate)
    .sort();

  if (!allDates.length) {
    throw new Error("Macro series are empty.");
  }

  const calendar = buildCalendar(allDates[0]!, asOfDate);

  const vix = alignSeries(macro.vix, calendar);
  const vxv = alignSeries(macro.vxv, calendar);
  const hy = alignSeries(macro.hyOas, calendar);
  const ig = alignSeries(macro.igOas, calendar);
  const dgs10 = alignSeries(macro.dgs10, calendar);
  const dfii10 = alignSeries(macro.dfii10, calendar);
  const t10y3m = alignSeries(macro.t10y3m, calendar);
  const usd = alignSeries(macro.usdBroad, calendar);
  const oil = alignSeries(macro.oilWti, calendar);
  const ovx = alignSeries(macro.ovx, calendar);
  const sofr = alignSeries(macro.sofr, calendar);
  const claims = alignSeries(macro.claims, calendar);
  const sahm = alignSeries(macro.sahm, calendar);
  const recProb = alignSeries(macro.recProb, calendar);
  const putCall = alignSeries(macro.putCall, calendar);

  const term = vxv.map((value, index) => value - vix[index]!);

  const panic = add(zNormalize(vix), zNormalize(putCall), scale(zNormalize(term), -0.7));
  const creditStress = add(zNormalize(hy), scale(zNormalize(ig), 0.5));
  const ratePressure = add(zNormalize(diff(dfii10, 20)), scale(zNormalize(diff(dgs10, 20)), 0.5));
  const oilShock = add(zNormalize(diff(oil, 5)), scale(zNormalize(ovx), 0.5));
  const usdShock = zNormalize(diff(usd, 20));

  const sofrSpread = sofr.map((value, index) => {
    if (!Number.isFinite(value)) return Number.NaN;
    return value - rollingMedian(sofr, 63, index);
  });
  const fundingStress = zNormalize(sofrSpread);

  const msi = add(
    panic,
    creditStress,
    scale(ratePressure, 0.8),
    scale(oilShock, 0.6),
    scale(usdShock, 0.4),
    scale(fundingStress, 0.4),
  );

  const msiLatest = latestFinite(msi);
  const msiValues = msi.filter((value) => Number.isFinite(value));
  const msiTrailing = msiValues.slice(-756);
  const msiLevel = percentile(msiLatest, msiTrailing.length ? msiTrailing : msiValues);

  const msiTrend5d = (() => {
    const lastIndex = msi.length - 1;
    if (lastIndex < 5) return 0;
    const prev = msi[lastIndex - 5]!;
    const current = msi[lastIndex]!;
    if (!Number.isFinite(prev) || !Number.isFinite(current)) return 0;
    return current - prev;
  })();

  let riskGate = 0.7;
  let regime: MacroSnapshot["regime"] = "neutral";

  if (msiLevel > 0.95 && msiTrend5d > 0) {
    riskGate = 0.2;
    regime = "panic_worsening";
  } else if (msiLevel > 0.8 && msiTrend5d < 0) {
    riskGate = 1.0;
    regime = "panic_improving";
  }

  const claimsDelta4w = (() => {
    if (claims.length < 21) return 0;
    const latest = claims[claims.length - 1]!;
    const prev4w = claims[claims.length - 21]!;
    return safeDivide(latest - prev4w, Math.abs(prev4w) || 1);
  })();

  const latestSahm = latestFinite(sahm);
  const latestRecProb = latestFinite(recProb);
  const latestCurve = latestFinite(t10y3m);

  const recessionRisk = clamp(
    0.35 * clamp(latestSahm / 0.8, 0, 1) +
      0.35 * clamp(latestRecProb / 100, 0, 1) +
      0.2 * clamp((claimsDelta4w + 0.1) / 0.25, 0, 1) +
      0.1 * clamp((-latestCurve) / 2, 0, 1),
    0,
    1,
  );

  const historyStart = Math.max(0, calendar.length - 60);
  const msiHistory = calendar.slice(historyStart).map((date, index) => ({
    date,
    msi: round(msi[historyStart + index] ?? 0, 4),
  }));

  return {
    latestRatePressure: latestFinite(ratePressure),
    latestRecessionRisk: recessionRisk,
    latestRiskGate: riskGate,
    snapshot: {
      asOf: asOfDate,
      msi: round(msiLatest, 4),
      msiLevel: round(msiLevel, 4),
      msiTrend5d: round(msiTrend5d, 4),
      riskGate: round(riskGate, 4),
      regime,
      recessionRisk: round(recessionRisk, 4),
      ratePressure: round(latestFinite(ratePressure), 4),
      creditStress: round(latestFinite(creditStress), 4),
      oilShock: round(latestFinite(oilShock), 4),
      fundingStress: round(latestFinite(fundingStress), 4),
      putCallZ: round(latestFinite(zNormalize(putCall)), 4),
      keyReadings: [
        { key: "VIXCLS", label: "VIX", value: round(latestRaw(macro.vix), 2) },
        { key: "VXVCLS", label: "VIX 3M", value: round(latestRaw(macro.vxv), 2) },
        { key: "HY_OAS", label: "HY OAS", value: round(latestRaw(macro.hyOas), 2), unit: "bp" },
        { key: "IG_OAS", label: "IG OAS", value: round(latestRaw(macro.igOas), 2), unit: "bp" },
        { key: "DGS10", label: "10Y Yield", value: round(latestRaw(macro.dgs10), 2), unit: "%" },
        { key: "DFII10", label: "10Y Real Yield", value: round(latestRaw(macro.dfii10), 2), unit: "%" },
        { key: "SOFR", label: "SOFR", value: round(latestRaw(macro.sofr), 2), unit: "%" },
        { key: "PUTCALL", label: "Put/Call", value: round(latestRaw(macro.putCall), 3) },
      ],
      msiHistory,
    },
  };
}

function computeRsi14(closes: number[]): number {
  if (closes.length < 15) return 50;

  const recent = closes.slice(-15);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < recent.length; i += 1) {
    const delta = recent[i]! - recent[i - 1]!;
    if (delta >= 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function returns(closes: number[], lag: number): number {
  if (closes.length <= lag) return 0;
  const now = closes[closes.length - 1]!;
  const prior = closes[closes.length - 1 - lag]!;
  if (!Number.isFinite(now) || !Number.isFinite(prior) || prior <= 0) return 0;
  return now / prior - 1;
}

function meanTail(values: number[], window: number): number {
  if (!values.length) return 0;
  return mean(values.slice(-window));
}

function computeRateBeta(bars: PriceBar[], dgs10ByDate: Map<string, number>): number {
  if (bars.length < 125) return 0;

  const x: number[] = [];
  const y: number[] = [];

  const recent = bars.slice(-121);
  for (let i = 1; i < recent.length; i += 1) {
    const bar = recent[i]!;
    const prev = recent[i - 1]!;
    const dgs = dgs10ByDate.get(bar.date);
    const dgsPrev = dgs10ByDate.get(prev.date);

    if (!Number.isFinite(dgs) || !Number.isFinite(dgsPrev)) {
      continue;
    }

    const stockRet = safeDivide(bar.close - prev.close, prev.close);
    if (!Number.isFinite(stockRet)) continue;

    y.push(stockRet);
    x.push(dgs! - dgsPrev!);
  }

  return linearRegressionBeta(x, y);
}

function computeFeatures(
  item: ReitUniverseItem,
  bars: PriceBar[],
  dgs10ByDate: Map<string, number>,
): ReitComputedFeatures | null {
  if (bars.length < 260) return null;

  const closes = bars.map((bar) => bar.close);
  const latest = closes[closes.length - 1]!;
  const max252 = Math.max(...closes.slice(-252));
  const dd52w = safeDivide(latest, max252) - 1;
  const rsi14 = computeRsi14(closes);
  const ret5d = returns(closes, 5);
  const ret20d = returns(closes, 20);
  const ret252d = returns(closes, 252);

  if (closes.length < 220) return null;
  const maNow = rollingMean(closes, 200, closes.length - 1);
  const maPrev = rollingMean(closes, 200, closes.length - 21);
  const ma200Slope = maNow - maPrev;

  const liqUsd20d = meanTail(bars.slice(-20).map((bar) => bar.close * bar.volume), 20);
  const rateBeta = computeRateBeta(bars, dgs10ByDate);

  return {
    ticker: item.ticker,
    name: item.name,
    propertyType: item.propertyType,
    aiStructural: item.aiStructural,
    dd52w,
    rsi14,
    ret5d,
    ret20d,
    ret252d,
    ma200Slope,
    rateBeta,
    liqUsd20d,
  };
}

function recessionTilt(propertyType: PropertyType, recessionRisk: number): number {
  if (recessionRisk <= 0.6) return 1;

  const intensity = clamp((recessionRisk - 0.6) / 0.4, 0, 1);

  if (CYCLICAL_PROPERTY_TYPES.has(propertyType)) {
    return 1 - 0.25 * intensity;
  }

  if (DEFENSIVE_PROPERTY_TYPES.has(propertyType)) {
    return 1 + 0.15 * intensity;
  }

  return 1;
}

function scoreToSignal(score: number): ReitRecommendation["signal"] {
  if (score >= 75) return "strong_buy";
  if (score >= 60) return "buy_dip";
  if (score >= 45) return "watch";
  return "hold_back";
}

function buildRationale(features: ReitComputedFeatures, score: number, regime: MacroSnapshot["regime"]): string[] {
  const notes: string[] = [];

  if (features.dd52w <= -0.2) {
    notes.push("Deep drawdown vs 52-week high");
  }

  if (features.rsi14 <= 35) {
    notes.push("Short-term oversold momentum");
  }

  if (features.ret252d > 0) {
    notes.push("Long-term trend still constructive");
  }

  if (features.rateBeta > 0.1) {
    notes.push("Would benefit if long rates ease");
  }

  if (regime === "panic_improving") {
    notes.push("Macro panic regime improving");
  }

  if (score < 45 && !notes.length) {
    notes.push("Macro and technical setup not aligned");
  }

  return notes.slice(0, 4);
}

function scoreRecommendations(
  features: ReitComputedFeatures[],
  macro: MacroDerived,
  topN: number,
): { recommendations: ReitRecommendation[]; tail: ReitRecommendation[] } {
  const ddRank = scoreByRank(features.map((f) => f.dd52w), "lower");
  const rsiRank = scoreByRank(features.map((f) => f.rsi14), "lower");
  const ret20Rank = scoreByRank(features.map((f) => f.ret20d), "lower");

  const ret252Rank = scoreByRank(features.map((f) => f.ret252d), "higher");
  const maRank = scoreByRank(features.map((f) => f.ma200Slope), "higher");

  const liquidityRank = scoreByRank(features.map((f) => f.liqUsd20d), "higher");

  const recommendations = features.map((feature, index) => {
    const dip = 0.5 * ddRank[index]! + 0.3 * rsiRank[index]! + 0.2 * ret20Rank[index]!;
    const trend = 0.6 * ret252Rank[index]! + 0.4 * maRank[index]!;
    const macroAlignment = sigmoid(-macro.latestRatePressure * feature.rateBeta * 1.4);
    const aiStructural = aiScoreToUnit(feature.aiStructural);
    const liquidity = liquidityRank[index]!;
    const tilt = recessionTilt(feature.propertyType, macro.latestRecessionRisk);

    const raw =
      REIT_SCORE_WEIGHTS.dip * dip +
      REIT_SCORE_WEIGHTS.trend * trend +
      REIT_SCORE_WEIGHTS.macroAlignment * macroAlignment +
      REIT_SCORE_WEIGHTS.aiStructural * aiStructural +
      REIT_SCORE_WEIGHTS.liquidity * liquidity;

    const score = clamp(100 * macro.latestRiskGate * raw * tilt, 0, 100);

    const recommendation: ReitRecommendation = {
      ticker: feature.ticker,
      name: feature.name,
      propertyType: feature.propertyType,
      score: round(score, 2),
      rank: 0,
      signal: scoreToSignal(score),
      rationale: buildRationale(feature, score, macro.snapshot.regime),
      features: {
        dd52wPct: round(feature.dd52w * 100, 2),
        rsi14: round(feature.rsi14, 2),
        ret20dPct: round(feature.ret20d * 100, 2),
        ret252dPct: round(feature.ret252d * 100, 2),
        rateBeta: round(feature.rateBeta, 3),
        liqUsd20d: round(feature.liqUsd20d, 0),
      },
      components: {
        dip: round(dip, 4),
        trend: round(trend, 4),
        macroAlignment: round(macroAlignment, 4),
        aiStructural: round(aiStructural, 4),
        liquidity: round(liquidity, 4),
        recessionTilt: round(tilt, 4),
      },
    };

    return recommendation;
  });

  recommendations.sort((a, b) => b.score - a.score);
  recommendations.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    recommendations: recommendations.slice(0, topN),
    tail: recommendations.slice(-5),
  };
}

export async function buildReitSnapshot(asOf = new Date()): Promise<ReitDashboardSnapshot> {
  const lookbackDays = Math.max(400, Math.round(envNumber("REIT_STRESS_LOOKBACK_DAYS", DEFAULT_LOOKBACK_DAYS)));
  const topN = Math.max(3, Math.round(envNumber("REIT_TOP_N", DEFAULT_TOP_N)));
  const liquidityFloorUsd = Math.max(
    100_000,
    Math.round(envNumber("REIT_LIQUIDITY_FLOOR_USD", DEFAULT_LIQUIDITY_FLOOR_USD)),
  );

  const [universe, macroInputs] = await Promise.all([loadReitUniverse(), fetchMacroInputs(lookbackDays)]);

  const priceResults = await mapWithConcurrency(universe, 6, async (item) => {
    try {
      const bars = await fetchTickerPriceHistory(item.ticker);
      return { item, bars };
    } catch {
      return { item, bars: [] as PriceBar[] };
    }
  });

  const macroDerived = computeMacroDerived(macroInputs, isoDate(asOf));
  const dgs10ByDate = new Map(macroInputs.dgs10.map((point) => [point.date, point.value]));

  const computedFeatures: ReitComputedFeatures[] = [];
  let skippedForLiquidity = 0;

  for (const { item, bars } of priceResults) {
    const features = computeFeatures(item, bars, dgs10ByDate);
    if (!features) continue;
    if (features.liqUsd20d < liquidityFloorUsd) {
      skippedForLiquidity += 1;
      continue;
    }
    computedFeatures.push(features);
  }

  if (!computedFeatures.length) {
    throw new Error("No REITs passed minimum history/liquidity filters.");
  }

  const { recommendations, tail } = scoreRecommendations(computedFeatures, macroDerived, topN);

  const notes: string[] = [];
  if (macroDerived.snapshot.regime === "panic_worsening") {
    notes.push("Stress is extreme and worsening; score outputs are intentionally suppressed.");
  }
  if (macroDerived.latestRecessionRisk > 0.65) {
    notes.push("Recession gate is active; cyclical property types are de-emphasized.");
  }
  if (skippedForLiquidity > 0) {
    notes.push(`${skippedForLiquidity} names were excluded by liquidity filter.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    asOf: isoDate(asOf),
    universeSize: universe.length,
    scoredUniverseSize: computedFeatures.length,
    topN: recommendations.length,
    parameters: {
      liquidityFloorUsd,
      stressLookbackDays: lookbackDays,
      scoreWeights: {
        dip: REIT_SCORE_WEIGHTS.dip,
        trend: REIT_SCORE_WEIGHTS.trend,
        macroAlignment: REIT_SCORE_WEIGHTS.macroAlignment,
        aiStructural: REIT_SCORE_WEIGHTS.aiStructural,
        liquidity: REIT_SCORE_WEIGHTS.liquidity,
      },
    },
    macro: macroDerived.snapshot,
    recommendations,
    tail,
    notes,
  };
}
