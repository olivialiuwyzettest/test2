import { format } from "date-fns";
import {
  CYCLICAL_PROPERTY_TYPES,
  DEFENSIVE_PROPERTY_TYPES,
  REIT_SCORE_WEIGHTS,
  aiScoreToUnit,
} from "./config";
import {
  fetchDividendYields,
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
  BuyWindowStatus,
  MacroInputs,
  MacroSeriesPoint,
  MarketDecisionSnapshot,
  MacroSnapshot,
  PriceBar,
  PropertyType,
  RecommendationAction,
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

type MacroIndicator = MacroSnapshot["indicators"][number];

type IndicatorDefinition = {
  key: string;
  label: string;
  values: number[];
  unit?: string;
  betterWhen: "higher" | "lower";
  why: string;
};

type DecisionFlags = {
  macroClosed: boolean;
  rateHeadwind: boolean;
  brokenTrend: boolean;
  stillFalling: boolean;
  recessionPenalty: boolean;
  highVolatility: boolean;
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

function formatPrice(value: number): string {
  return `$${round(value, 2).toFixed(2)}`;
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

function latestFiniteIndex(values: number[]): number {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) return i;
  }
  return -1;
}

function computeLagDelta(values: number[], lag: number): { abs: number | null; pct: number | null } {
  const latestIndex = latestFiniteIndex(values);
  if (latestIndex < 0 || latestIndex < lag) {
    return { abs: null, pct: null };
  }

  const current = values[latestIndex]!;
  const prior = values[latestIndex - lag]!;

  if (!Number.isFinite(current) || !Number.isFinite(prior)) {
    return { abs: null, pct: null };
  }

  const abs = current - prior;
  const pct = Math.abs(prior) > 0 ? (abs / Math.abs(prior)) * 100 : null;

  return {
    abs: round(abs, 3),
    pct: pct === null || !Number.isFinite(pct) ? null : round(pct, 2),
  };
}

function classifyStatus(
  delta: number | null,
  betterWhen: "higher" | "lower",
): "improving" | "worsening" | "flat" {
  if (delta === null || Math.abs(delta) < 0.0001) return "flat";
  if (betterWhen === "lower") return delta < 0 ? "improving" : "worsening";
  return delta > 0 ? "improving" : "worsening";
}

function impactFromStatus(status: "improving" | "worsening" | "flat"): "tailwind" | "headwind" | "neutral" {
  if (status === "improving") return "tailwind";
  if (status === "worsening") return "headwind";
  return "neutral";
}

function buildIndicator(def: IndicatorDefinition): MacroIndicator {
  const latestIndex = latestFiniteIndex(def.values);
  const value = latestIndex >= 0 ? def.values[latestIndex]! : 0;

  const dodDelta = computeLagDelta(def.values, 1);
  const momDelta = computeLagDelta(def.values, 21);
  const yoyDelta = computeLagDelta(def.values, 252);
  const status = classifyStatus(momDelta.abs, def.betterWhen);
  const reitImpact = impactFromStatus(status);

  const statusText =
    status === "improving" ? "Improving trend." : status === "worsening" ? "Worsening trend." : "Trend is flat.";

  return {
    key: def.key,
    label: def.label,
    value: round(value, 3),
    unit: def.unit,
    betterWhen: def.betterWhen,
    dod: dodDelta.abs,
    mom: momDelta.abs,
    yoy: yoyDelta.abs,
    dodPct: dodDelta.pct,
    momPct: momDelta.pct,
    yoyPct: yoyDelta.pct,
    status,
    reitImpact,
    interpretation: `${statusText} ${def.why}`,
  };
}

function classifyCyclePhase(
  msiLevel: number,
  msiTrend5d: number,
  recessionRisk: number,
  ratePressure: number,
): {
  phase: MacroSnapshot["cyclePhase"];
  cycleScore: number;
  summary: string;
  playbook: string[];
} {
  const cycleScore = round(
    clamp(
      100 -
        clamp(msiLevel, 0, 1) * 45 -
        clamp(recessionRisk, 0, 1) * 40 -
        clamp((ratePressure + 1.5) / 3, 0, 1) * 15,
      0,
      100,
    ),
    1,
  );

  if (msiLevel > 0.9 && msiTrend5d > 0) {
    return {
      phase: "panic_shock",
      cycleScore,
      summary: "High and rising stress. Preserve dry powder and avoid forced dip-buying.",
      playbook: [
        "Prioritize capital preservation; avoid adding to low-liquidity names.",
        "Wait for MSI trend to turn down before scaling into new entries.",
        "Focus only on highest-quality balance sheets and defensive property types.",
      ],
    };
  }

  if (recessionRisk > 0.7) {
    return {
      phase: "late_contraction",
      cycleScore,
      summary: "Recession risk is elevated. Be selective and defensive in new REIT exposure.",
      playbook: [
        "Favor residential, healthcare, and net lease over cyclical segments.",
        "Use smaller position sizes and stagger entries over multiple days.",
        "Require stronger trend confirmation before upgrading to Strong Buy.",
      ],
    };
  }

  if (msiLevel > 0.8 && msiTrend5d < 0) {
    return {
      phase: "early_recovery",
      cycleScore,
      summary: "Stress is still high but easing. This is the best setup for controlled dip buying.",
      playbook: [
        "Scale into Weak Buy names in 2-3 tranches instead of one order.",
        "Favor names with high liquidity and improving technical trend.",
        "Recheck rate-pressure trend daily; reduce adds if rates re-accelerate upward.",
      ],
    };
  }

  if (ratePressure > 0.5) {
    return {
      phase: "late_cycle_tightening",
      cycleScore,
      summary: "Rates are a headwind. Stay selective and prioritize resilient cash-flow REITs.",
      playbook: [
        "Prefer lower-beta REITs and stronger balance-sheet quality.",
        "Demand larger drawdown discounts before entering rate-sensitive names.",
        "Trim exposure to highly leveraged or cyclical property types.",
      ],
    };
  }

  if (recessionRisk < 0.35 && msiLevel < 0.6) {
    return {
      phase: "mid_cycle_expansion",
      cycleScore,
      summary: "Macro backdrop is relatively supportive. Broad participation is acceptable.",
      playbook: [
        "You can diversify across defensive and growth-oriented REIT sub-sectors.",
        "Use score rank as the primary filter, then confirm with trend and liquidity.",
        "Keep some dry powder for volatility spikes to improve entry prices.",
      ],
    };
  }

  return {
    phase: "transition",
    cycleScore,
    summary: "Mixed macro signals. Stay balanced and favor incremental positioning.",
    playbook: [
      "Use partial entries and reassess after each major macro release.",
      "Prefer names where both macro alignment and trend score are positive.",
      "Avoid concentrating too heavily in one property type.",
    ],
  };
}

function classifyMacroBuyWindow(
  msiLevel: number,
  msiTrend5d: number,
  recessionRisk: number,
  ratePressure: number,
): {
  status: BuyWindowStatus;
  score: number;
  summary: string;
  checklist: string[];
} {
  const score = round(
    clamp(
      100 -
        clamp(msiLevel, 0, 1) * 32 -
        clamp(recessionRisk, 0, 1) * 38 -
        clamp((ratePressure + 1.2) / 2.4, 0, 1) * 18 +
        (msiTrend5d < 0 ? 8 : 0),
      0,
      100,
    ),
    1,
  );

  if (msiLevel > 0.92 && msiTrend5d > 0) {
    return {
      status: "closed",
      score,
      summary: "Do not add new REIT risk while stress is extreme and still worsening.",
      checklist: [
        "Wait for Macro Stress Index 5-day trend to turn negative.",
        "Avoid full-size entries even in high-quality names.",
        "Keep new buys on hold until rates and credit spreads stabilize.",
      ],
    };
  }

  if (recessionRisk > 0.75 && msiTrend5d >= 0) {
    return {
      status: "closed",
      score,
      summary: "Recession risk is too elevated for broad REIT buying. Preserve cash and stay defensive.",
      checklist: [
        "Require defensive property types if you buy anything at all.",
        "Use only starter-size entries after clear price stabilization.",
        "Wait for claims, spreads, or the yield curve to stop deteriorating.",
      ],
    };
  }

  if ((msiLevel > 0.8 && msiTrend5d < 0) || (recessionRisk < 0.45 && ratePressure < 0.2 && msiLevel < 0.7)) {
    return {
      status: "open",
      score,
      summary: "The macro buy window is open. You can start new REIT positions if the individual chart confirms.",
      checklist: [
        "Prioritize Buy Now or Scale In names with conviction above 70.",
        "Use staged entries instead of all-in orders.",
        "Pause if 10Y yields re-accelerate upward over the next few sessions.",
      ],
    };
  }

  return {
    status: "selective",
    score,
    summary: "The macro tape is mixed. Buy only the cleanest setups and size entries conservatively.",
    checklist: [
      "Require both macro alignment and price confirmation before buying.",
      "Keep starter sizes small and add only after follow-through.",
      "Favor liquid, defensive, or AI-tailwind property types over weaker sub-sectors.",
    ],
  };
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

  const latestRatePressure = latestFinite(ratePressure);
  const cycle = classifyCyclePhase(msiLevel, msiTrend5d, recessionRisk, latestRatePressure);
  const buyWindow = classifyMacroBuyWindow(msiLevel, msiTrend5d, recessionRisk, latestRatePressure);
  const indicators: MacroIndicator[] = [
    buildIndicator({
      key: "VIXCLS",
      label: "VIX",
      values: vix,
      betterWhen: "lower",
      why: "Lower equity volatility usually supports risk appetite for REIT allocations.",
    }),
    buildIndicator({
      key: "HY_OAS",
      label: "HY OAS",
      values: hy,
      unit: "bp",
      betterWhen: "lower",
      why: "Tighter credit spreads reduce refinancing stress for leveraged real estate.",
    }),
    buildIndicator({
      key: "IG_OAS",
      label: "IG OAS",
      values: ig,
      unit: "bp",
      betterWhen: "lower",
      why: "Lower IG spreads indicate easier financing conditions and lower default fear.",
    }),
    buildIndicator({
      key: "DGS10",
      label: "10Y Yield",
      values: dgs10,
      unit: "%",
      betterWhen: "lower",
      why: "Lower long rates generally support REIT valuations and cap-rate spreads.",
    }),
    buildIndicator({
      key: "DFII10",
      label: "10Y Real Yield",
      values: dfii10,
      unit: "%",
      betterWhen: "lower",
      why: "Lower real yields improve relative attractiveness of REIT income streams.",
    }),
    buildIndicator({
      key: "SOFR",
      label: "SOFR",
      values: sofr,
      unit: "%",
      betterWhen: "lower",
      why: "Lower short-term funding costs ease floating-rate debt pressure.",
    }),
    buildIndicator({
      key: "ICSA",
      label: "Initial Claims",
      values: claims,
      betterWhen: "lower",
      why: "Rising claims can signal demand softening, especially for cyclical REIT segments.",
    }),
    buildIndicator({
      key: "T10Y3M",
      label: "10Y-3M Curve",
      values: t10y3m,
      unit: "%",
      betterWhen: "higher",
      why: "A less-inverted curve usually indicates improving forward growth expectations.",
    }),
    buildIndicator({
      key: "PUTCALL",
      label: "Put/Call Ratio",
      values: putCall,
      betterWhen: "lower",
      why: "Lower option-hedging demand usually reflects lower broad-market panic.",
    }),
  ];

  return {
    latestRatePressure,
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
      cyclePhase: cycle.phase,
      cycleScore: cycle.cycleScore,
      macroSummary: cycle.summary,
      decisionPlaybook: cycle.playbook,
      buyWindowStatus: buyWindow.status,
      buyWindowScore: buyWindow.score,
      buyWindowSummary: buyWindow.summary,
      pullTriggerChecklist: buyWindow.checklist,
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
      indicators,
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
  const low20 = Math.min(...closes.slice(-20));
  const high20 = Math.max(...closes.slice(-20));
  const dd52w = safeDivide(latest, max252) - 1;
  const rsi14 = computeRsi14(closes);
  const ret5d = returns(closes, 5);
  const ret20d = returns(closes, 20);
  const ret252d = returns(closes, 252);

  if (closes.length < 220) return null;
  const maNow = rollingMean(closes, 200, closes.length - 1);
  const maPrev = rollingMean(closes, 200, closes.length - 21);
  const ma200Slope = maNow - maPrev;
  const ma200Distance = safeDivide(latest, maNow) - 1;

  const dailyReturns = bars
    .slice(-21)
    .map((bar, index, recent) => {
      if (index === 0) return Number.NaN;
      return safeDivide(bar.close - recent[index - 1]!.close, recent[index - 1]!.close);
    })
    .filter((value) => Number.isFinite(value));
  const volatility20d = stdDev(dailyReturns);

  const liqUsd20d = meanTail(bars.slice(-20).map((bar) => bar.close * bar.volume), 20);
  const rateBeta = computeRateBeta(bars, dgs10ByDate);

  return {
    ticker: item.ticker,
    name: item.name,
    propertyType: item.propertyType,
    aiStructural: item.aiStructural,
    lastClose: latest,
    dd52w,
    rsi14,
    ret5d,
    ret20d,
    ret252d,
    ma200Slope,
    ma200Distance,
    distanceFrom20dLow: safeDivide(latest, low20) - 1,
    distanceTo20dHigh: safeDivide(latest, high20) - 1,
    volatility20d,
    rateBeta,
    liqUsd20d,
    dividendYieldPct: null,
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

function computeConfirmationScore(feature: ReitComputedFeatures): number {
  const shortMomentum = clamp((feature.ret5d + 0.04) / 0.08, 0, 1);
  const bounce = 1 - clamp(Math.abs(feature.distanceFrom20dLow - 0.035) / 0.08, 0, 1);
  const rsiWindow = 1 - clamp(Math.abs(feature.rsi14 - 40) / 24, 0, 1);
  const maWindow = clamp((feature.ma200Distance + 0.08) / 0.18, 0, 1);

  return clamp(0.35 * shortMomentum + 0.3 * bounce + 0.2 * rsiWindow + 0.15 * maWindow, 0, 1);
}

function buildDecisionFlags(feature: ReitComputedFeatures, macro: MacroDerived): DecisionFlags {
  return {
    macroClosed: macro.snapshot.buyWindowStatus === "closed" || macro.snapshot.regime === "panic_worsening",
    rateHeadwind: macro.latestRatePressure > 0.55 && feature.rateBeta > 0.25,
    brokenTrend: feature.ret252d < -0.15 && feature.ma200Slope < 0,
    stillFalling: feature.ret5d < -0.03 && feature.distanceFrom20dLow < 0.015,
    recessionPenalty:
      macro.latestRecessionRisk > 0.7 && CYCLICAL_PROPERTY_TYPES.has(feature.propertyType),
    highVolatility: feature.volatility20d > 0.028,
  };
}

function buildBlockers(flags: DecisionFlags): string[] {
  const blockers: string[] = [];

  if (flags.macroClosed) {
    blockers.push("Macro buy window is closed. Broad REIT buying should wait.");
  }
  if (flags.rateHeadwind) {
    blockers.push("Rates are still rising against a rate-sensitive REIT.");
  }
  if (flags.brokenTrend) {
    blockers.push("Long-term trend is still broken.");
  }
  if (flags.stillFalling) {
    blockers.push("Price is still falling without a clear stabilization bounce.");
  }
  if (flags.recessionPenalty) {
    blockers.push("Recession gate penalizes this cyclical property type.");
  }
  if (flags.highVolatility) {
    blockers.push("Recent volatility is elevated, so entry risk is higher.");
  }

  return blockers;
}

function buildUpgradeTriggers(feature: ReitComputedFeatures, macro: MacroDerived, flags: DecisionFlags): string[] {
  const upgrades: string[] = [];

  if (flags.stillFalling || feature.ret5d <= 0) {
    upgrades.push("Wait for the 5-day return to turn positive.");
  }
  if (feature.distanceFrom20dLow < 0.03) {
    upgrades.push("Wait for price to hold 2%-4% above the 20-day low.");
  }
  if (flags.brokenTrend || feature.ret20d <= 0) {
    upgrades.push("Require a better 20-day trend or a flattening 200-day slope.");
  }
  if (flags.rateHeadwind) {
    upgrades.push("Prefer a flat-to-down 10Y yield trend before adding aggressively.");
  }
  if (flags.macroClosed) {
    upgrades.push("Need the macro buy window to reopen before treating this as a true buy.");
  }
  if (!upgrades.length && macro.snapshot.buyWindowStatus !== "closed") {
    upgrades.push("If macro stays stable for another 1-2 sessions, conviction improves.");
  }

  return upgrades.slice(0, 3);
}

function computeRiskPenalty(feature: ReitComputedFeatures, flags: DecisionFlags): number {
  let penalty = 1;

  if (flags.macroClosed) penalty -= 0.18;
  if (flags.rateHeadwind) penalty -= 0.08;
  if (flags.brokenTrend) penalty -= 0.14;
  if (flags.stillFalling) penalty -= 0.1;
  if (flags.recessionPenalty) penalty -= 0.1;
  if (flags.highVolatility) penalty -= 0.06;
  if (feature.distanceTo20dHigh > -0.02) penalty -= 0.03;

  return clamp(penalty, 0.5, 1);
}

function decideAction(
  score: number,
  timingScore: number,
  conviction: number,
  flags: DecisionFlags,
  macro: MacroDerived,
): RecommendationAction {
  const majorBlockers = [flags.macroClosed, flags.brokenTrend, flags.stillFalling, flags.recessionPenalty].filter(
    Boolean,
  ).length;

  if (flags.macroClosed || score < 42 || majorBlockers >= 3) {
    return "avoid";
  }

  if (
    score >= 76 &&
    timingScore >= 68 &&
    conviction >= 72 &&
    majorBlockers === 0 &&
    macro.latestRiskGate >= 0.7
  ) {
    return "buy_now";
  }

  if (score >= 62 && timingScore >= 52 && conviction >= 60 && majorBlockers <= 1 && macro.latestRiskGate >= 0.7) {
    return "scale_in";
  }

  if (score >= 48 || timingScore >= 44 || conviction >= 52) {
    return "wait_for_confirmation";
  }

  return "avoid";
}

function signalFromAction(action: RecommendationAction): ReitRecommendation["signal"] {
  if (action === "buy_now") return "strong_buy";
  if (action === "scale_in") return "buy_dip";
  if (action === "wait_for_confirmation") return "watch";
  return "hold_back";
}

function buildDecisionSummary(
  action: RecommendationAction,
  feature: ReitComputedFeatures,
  macro: MacroDerived,
): string {
  if (action === "buy_now") {
    return "Pull the trigger on a starter position. The selloff has stabilized and the macro tape is supportive enough.";
  }

  if (action === "scale_in") {
    return "Attractive dip, but not a full-size entry. Start small and add only after price follow-through.";
  }

  if (action === "wait_for_confirmation") {
    return "Good watchlist candidate, but the chart or macro tape has not confirmed the buy yet.";
  }

  if (macro.snapshot.buyWindowStatus === "closed") {
    return "Do not buy yet. The macro buy window is closed, so patience matters more than ranking.";
  }

  if (feature.ret252d < -0.15) {
    return "Do not buy yet. The long-term downtrend still looks broken.";
  }

  return "Do not buy yet. Too many headwinds remain active.";
}

function buildEntryPlan(
  action: RecommendationAction,
  feature: ReitComputedFeatures,
): ReitRecommendation["entryPlan"] {
  const retestLevel = feature.lastClose * 0.97;
  const breakoutLevel = feature.lastClose * 1.01;
  const low20 = feature.lastClose / Math.max(1 + feature.distanceFrom20dLow, 0.0001);
  const abortLevel = low20 * 0.98;

  if (action === "buy_now") {
    return {
      starterSizePct: 35,
      maxSizePct: 100,
      buyRule: `Start 35% of target size near ${formatPrice(feature.lastClose)} on the next session.`,
      addRule: `Add 35% on a controlled retest near ${formatPrice(retestLevel)} or after a close above ${formatPrice(
        breakoutLevel,
      )}.`,
      abortRule: `Pause buying if price closes below ${formatPrice(abortLevel)}.`,
    };
  }

  if (action === "scale_in") {
    return {
      starterSizePct: 20,
      maxSizePct: 75,
      buyRule: `Start with 20% only if price holds near ${formatPrice(feature.lastClose)} instead of breaking lower.`,
      addRule: `Add 25% only after a close above ${formatPrice(breakoutLevel)} and a positive 5-day return.`,
      abortRule: `Stand aside if price closes below ${formatPrice(abortLevel)}.`,
    };
  }

  if (action === "wait_for_confirmation") {
    return {
      starterSizePct: 0,
      maxSizePct: 50,
      buyRule: `Do not buy yet. Trigger only after a close above ${formatPrice(breakoutLevel)} with better follow-through.`,
      addRule: "If that happens, begin with a 20% starter position rather than full size.",
      abortRule: `Remove from active watch if price closes below ${formatPrice(abortLevel)}.`,
    };
  }

  return {
    starterSizePct: 0,
    maxSizePct: 0,
    buyRule: "No entry while current blockers remain active.",
    addRule: "Revisit only after macro and price trend both improve.",
    abortRule: `No buy if price remains below ${formatPrice(breakoutLevel)} and macro pressure persists.`,
  };
}

function buildRationale(
  features: ReitComputedFeatures,
  score: number,
  action: RecommendationAction,
  regime: MacroSnapshot["regime"],
): string[] {
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

  if (features.dividendYieldPct !== null && features.dividendYieldPct >= 4) {
    notes.push("Attractive dividend yield support");
  }

  if (regime === "panic_improving") {
    notes.push("Macro panic regime improving");
  }

  if (action === "buy_now") {
    notes.push("Price action is stabilizing enough for a starter entry");
  }

  if (action === "scale_in") {
    notes.push("Use staged buying instead of full-size entry");
  }

  if (score < 45 && !notes.length) {
    notes.push("Macro and technical setup not aligned");
  }

  return notes.slice(0, 4);
}

function buildMarketDecision(
  recommendations: ReitRecommendation[],
  macro: MacroDerived,
): MarketDecisionSnapshot {
  const total = Math.max(recommendations.length, 1);
  const oversoldCount = recommendations.filter(
    (item) => item.features.dd52wPct <= -15 || item.features.rsi14 <= 35,
  ).length;
  const positive5dCount = recommendations.filter((item) => item.features.ret5dPct > 0).length;
  const positiveTrendCount = recommendations.filter(
    (item) => item.features.ret252dPct > 0 || item.features.ma200DistancePct > 0,
  ).length;
  const buyNowCount = recommendations.filter((item) => item.action === "buy_now").length;
  const scaleInCount = recommendations.filter((item) => item.action === "scale_in").length;

  const breadthScore = clamp(
    100 *
      (0.4 * (positive5dCount / total) +
        0.35 * (positiveTrendCount / total) +
        0.25 * clamp((buyNowCount + scaleInCount) / Math.max(total * 0.4, 1), 0, 1)),
    0,
    100,
  );

  let status: BuyWindowStatus = macro.snapshot.buyWindowStatus;
  const score = round(0.65 * macro.snapshot.buyWindowScore + 0.35 * breadthScore, 1);

  if (macro.snapshot.buyWindowStatus !== "closed") {
    if (score >= 72 && buyNowCount >= 2 && positive5dCount / total >= 0.4) {
      status = "open";
    } else if (score >= 52 && buyNowCount + scaleInCount >= 3) {
      status = "selective";
    } else {
      status = "closed";
    }
  }

  const summary =
    status === "open"
      ? "Pull the trigger only on Buy Now names. Market breadth and macro are aligned enough for new REIT exposure."
      : status === "selective"
        ? "Be selective. Buy only the highest-conviction names and use staged entries."
        : "Wait. Macro and breadth are not strong enough to justify fresh REIT buying.";

  const triggerThreshold = status === "open" ? 68 : 74;

  return {
    status,
    score,
    summary,
    pullTriggerRule:
      status === "closed"
        ? "No new buys until the market buy window improves."
        : `Only buy tickers marked ${status === "open" ? "Buy Now" : "Buy Now or Scale In"} with conviction above ${triggerThreshold}.`,
    breadth: {
      oversoldPct: round((oversoldCount / total) * 100, 1),
      positive5dPct: round((positive5dCount / total) * 100, 1),
      positiveTrendPct: round((positiveTrendCount / total) * 100, 1),
      buyNowCount,
      scaleInCount,
    },
    checklist:
      status === "open"
        ? [
            "Start with the top Buy Now names only.",
            "Use 25%-35% starter size instead of full-size entries.",
            "Stop adding if macro buy window falls back to Selective or Closed.",
          ]
        : status === "selective"
          ? [
              "Limit new buys to the best 2-4 setups.",
              "Require price confirmation before every add.",
              "Favor liquid, defensive, or AI-tailwind property types.",
            ]
          : [
              "Stay in watch mode rather than forcing buys.",
              "Wait for stronger breadth and a friendlier macro tape.",
              "Keep dry powder for a cleaner entry window.",
            ],
  };
}

function scoreRecommendations(
  features: ReitComputedFeatures[],
  macro: MacroDerived,
  topN: number,
): {
  ranked: ReitRecommendation[];
  recommendations: ReitRecommendation[];
  tail: ReitRecommendation[];
  marketDecision: MarketDecisionSnapshot;
} {
  const ddRank = scoreByRank(features.map((f) => f.dd52w), "lower");
  const rsiRank = scoreByRank(features.map((f) => f.rsi14), "lower");
  const ret5Rank = scoreByRank(features.map((f) => f.ret5d), "higher");
  const ret20Rank = scoreByRank(features.map((f) => f.ret20d), "lower");

  const ret252Rank = scoreByRank(features.map((f) => f.ret252d), "higher");
  const maRank = scoreByRank(features.map((f) => f.ma200Slope), "higher");
  const maDistanceRank = scoreByRank(features.map((f) => f.ma200Distance), "higher");

  const liquidityRank = scoreByRank(features.map((f) => f.liqUsd20d), "higher");
  const volatilityRank = scoreByRank(features.map((f) => f.volatility20d), "lower");
  const yieldRankRaw = scoreByRank(
    features.map((f) => (f.dividendYieldPct === null ? Number.NaN : f.dividendYieldPct)),
    "higher",
  );
  const yieldRank = yieldRankRaw.map((value, index) =>
    features[index]!.dividendYieldPct === null ? 0.45 : value,
  );

  const recommendations = features.map((feature, index) => {
    const dip =
      0.45 * ddRank[index]! +
      0.2 * rsiRank[index]! +
      0.15 * ret20Rank[index]! +
      0.2 * yieldRank[index]!;
    const trend =
      0.45 * ret252Rank[index]! + 0.25 * maRank[index]! + 0.2 * maDistanceRank[index]! + 0.1 * ret5Rank[index]!;
    const macroAlignment = sigmoid(-macro.latestRatePressure * feature.rateBeta * 1.4);
    const confirmation = computeConfirmationScore(feature);
    const yieldSupport = yieldRank[index]!;
    const aiStructural = aiScoreToUnit(feature.aiStructural);
    const liquidity = liquidityRank[index]!;
    const tilt = recessionTilt(feature.propertyType, macro.latestRecessionRisk);
    const flags = buildDecisionFlags(feature, macro);
    const riskPenalty = computeRiskPenalty(feature, flags) * (0.85 + 0.15 * volatilityRank[index]!);

    const raw =
      0.26 * dip +
      0.22 * trend +
      0.18 * macroAlignment +
      0.14 * confirmation +
      0.1 * yieldSupport +
      0.05 * aiStructural +
      0.05 * liquidity;

    const score = clamp(100 * macro.latestRiskGate * raw * tilt * riskPenalty, 0, 100);
    const timingScore =
      100 *
      clamp(
        (0.45 * confirmation +
          0.2 * macroAlignment +
          0.15 * yieldSupport +
          0.2 * (0.6 * ret5Rank[index]! + 0.4 * maDistanceRank[index]!)) *
          (0.75 + 0.25 * macro.latestRiskGate),
        0,
        1,
      );
    const conviction = clamp(0.65 * score + 0.35 * timingScore, 0, 100);
    const action = decideAction(score, timingScore, conviction, flags, macro);
    const blockers = buildBlockers(flags).slice(0, 3);
    const upgradeTriggers = buildUpgradeTriggers(feature, macro, flags);

    const recommendation: ReitRecommendation = {
      ticker: feature.ticker,
      name: feature.name,
      propertyType: feature.propertyType,
      score: round(score, 2),
      rank: 0,
      action,
      conviction: round(conviction, 1),
      timingScore: round(timingScore, 1),
      signal: signalFromAction(action),
      decisionSummary: buildDecisionSummary(action, feature, macro),
      blockers,
      upgradeTriggers,
      entryPlan: buildEntryPlan(action, feature),
      rationale: buildRationale(feature, score, action, macro.snapshot.regime),
      features: {
        lastClose: round(feature.lastClose, 2),
        dd52wPct: round(feature.dd52w * 100, 2),
        rsi14: round(feature.rsi14, 2),
        ret5dPct: round(feature.ret5d * 100, 2),
        ret20dPct: round(feature.ret20d * 100, 2),
        ret252dPct: round(feature.ret252d * 100, 2),
        ma200DistancePct: round(feature.ma200Distance * 100, 2),
        distanceFrom20dLowPct: round(feature.distanceFrom20dLow * 100, 2),
        distanceTo20dHighPct: round(feature.distanceTo20dHigh * 100, 2),
        volatility20dPct: round(feature.volatility20d * 100, 2),
        rateBeta: round(feature.rateBeta, 3),
        liqUsd20d: round(feature.liqUsd20d, 0),
        dividendYieldPct:
          feature.dividendYieldPct === null ? null : round(feature.dividendYieldPct, 2),
      },
      components: {
        dip: round(dip, 4),
        trend: round(trend, 4),
        macroAlignment: round(macroAlignment, 4),
        confirmation: round(confirmation, 4),
        yieldSupport: round(yieldSupport, 4),
        aiStructural: round(aiStructural, 4),
        liquidity: round(liquidity, 4),
        recessionTilt: round(tilt, 4),
        riskPenalty: round(riskPenalty, 4),
      },
    };

    return recommendation;
  });

  recommendations.sort((a, b) => {
    if (b.conviction !== a.conviction) return b.conviction - a.conviction;
    if (b.score !== a.score) return b.score - a.score;
    return b.timingScore - a.timingScore;
  });
  recommendations.forEach((item, index) => {
    item.rank = index + 1;
  });

  const marketDecision = buildMarketDecision(recommendations, macro);

  return {
    ranked: recommendations,
    recommendations: recommendations.slice(0, topN),
    tail: recommendations.slice(-5),
    marketDecision,
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

  const yieldByTicker = await fetchDividendYields(computedFeatures.map((item) => item.ticker));
  const featuresWithYield = computedFeatures.map((item) => ({
    ...item,
    dividendYieldPct: yieldByTicker.get(item.ticker) ?? null,
  }));

  const { ranked, recommendations, tail, marketDecision } = scoreRecommendations(
    featuresWithYield,
    macroDerived,
    topN,
  );

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
  if (marketDecision.status === "closed") {
    notes.push("Market buy window is closed. Wait for better macro plus breadth before opening new positions.");
  } else if (marketDecision.status === "selective") {
    notes.push("Market buy window is selective. Use staged entries and focus on the highest-conviction setups.");
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
        confirmation: REIT_SCORE_WEIGHTS.confirmation,
        yieldSupport: REIT_SCORE_WEIGHTS.yieldSupport,
        aiStructural: REIT_SCORE_WEIGHTS.aiStructural,
        liquidity: REIT_SCORE_WEIGHTS.liquidity,
      },
    },
    macro: macroDerived.snapshot,
    marketDecision,
    ranked,
    recommendations,
    tail,
    notes,
  };
}
