export type PropertyType =
  | "data_center"
  | "tower"
  | "industrial"
  | "self_storage"
  | "residential"
  | "healthcare"
  | "net_lease"
  | "office"
  | "lodging"
  | "retail"
  | "gaming"
  | "specialty"
  | "other";

export type BuyWindowStatus = "open" | "selective" | "closed";

export type RecommendationAction =
  | "buy_now"
  | "scale_in"
  | "wait_for_confirmation"
  | "avoid";

export type ReitUniverseItem = {
  ticker: string;
  name: string;
  propertyType: PropertyType;
  aiStructural: number;
};

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MacroSeriesPoint = {
  date: string;
  value: number;
};

export type MacroInputs = {
  vix: MacroSeriesPoint[];
  vxv: MacroSeriesPoint[];
  hyOas: MacroSeriesPoint[];
  igOas: MacroSeriesPoint[];
  dgs10: MacroSeriesPoint[];
  dfii10: MacroSeriesPoint[];
  t10y3m: MacroSeriesPoint[];
  usdBroad: MacroSeriesPoint[];
  oilWti: MacroSeriesPoint[];
  ovx: MacroSeriesPoint[];
  sofr: MacroSeriesPoint[];
  claims: MacroSeriesPoint[];
  sahm: MacroSeriesPoint[];
  recProb: MacroSeriesPoint[];
  putCall: MacroSeriesPoint[];
};

export type MacroSnapshot = {
  asOf: string;
  msi: number;
  msiLevel: number;
  msiTrend5d: number;
  riskGate: number;
  regime: "panic_worsening" | "panic_improving" | "neutral";
  recessionRisk: number;
  ratePressure: number;
  creditStress: number;
  oilShock: number;
  fundingStress: number;
  putCallZ: number;
  cyclePhase:
    | "panic_shock"
    | "late_contraction"
    | "late_cycle_tightening"
    | "mid_cycle_expansion"
    | "early_recovery"
    | "transition";
  cycleScore: number;
  macroSummary: string;
  decisionPlaybook: string[];
  buyWindowStatus: BuyWindowStatus;
  buyWindowScore: number;
  buyWindowSummary: string;
  pullTriggerChecklist: string[];
  keyReadings: Array<{
    key: string;
    label: string;
    value: number;
    unit?: string;
  }>;
  indicators: Array<{
    key: string;
    label: string;
    value: number;
    unit?: string;
    betterWhen: "higher" | "lower";
    dod: number | null;
    mom: number | null;
    yoy: number | null;
    dodPct: number | null;
    momPct: number | null;
    yoyPct: number | null;
    status: "improving" | "worsening" | "flat";
    reitImpact: "tailwind" | "headwind" | "neutral";
    interpretation: string;
  }>;
  msiHistory: Array<{
    date: string;
    msi: number;
  }>;
};

export type ReitComputedFeatures = {
  ticker: string;
  name: string;
  propertyType: PropertyType;
  aiStructural: number;
  lastClose: number;
  dd52w: number;
  rsi14: number;
  ret5d: number;
  ret20d: number;
  ret252d: number;
  ma200Slope: number;
  ma200Distance: number;
  distanceFrom20dLow: number;
  distanceTo20dHigh: number;
  volatility20d: number;
  rateBeta: number;
  liqUsd20d: number;
  dividendYieldPct: number | null;
};

export type ReitRecommendation = {
  ticker: string;
  name: string;
  propertyType: PropertyType;
  score: number;
  rank: number;
  action: RecommendationAction;
  conviction: number;
  timingScore: number;
  signal: "strong_buy" | "buy_dip" | "watch" | "hold_back";
  decisionSummary: string;
  blockers: string[];
  upgradeTriggers: string[];
  entryPlan: {
    starterSizePct: number;
    maxSizePct: number;
    buyRule: string;
    addRule: string;
    abortRule: string;
  };
  rationale: string[];
  features: {
    lastClose: number;
    dd52wPct: number;
    rsi14: number;
    ret5dPct: number;
    ret20dPct: number;
    ret252dPct: number;
    ma200DistancePct: number;
    distanceFrom20dLowPct: number;
    distanceTo20dHighPct: number;
    volatility20dPct: number;
    rateBeta: number;
    liqUsd20d: number;
    dividendYieldPct: number | null;
  };
  components: {
    dip: number;
    trend: number;
    macroAlignment: number;
    confirmation: number;
    yieldSupport: number;
    aiStructural: number;
    liquidity: number;
    recessionTilt: number;
    riskPenalty: number;
  };
};

export type MarketDecisionSnapshot = {
  status: BuyWindowStatus;
  score: number;
  summary: string;
  pullTriggerRule: string;
  breadth: {
    oversoldPct: number;
    positive5dPct: number;
    positiveTrendPct: number;
    buyNowCount: number;
    scaleInCount: number;
  };
  checklist: string[];
};

export type ReitDashboardSnapshot = {
  generatedAt: string;
  asOf: string;
  universeSize: number;
  scoredUniverseSize: number;
  topN: number;
  parameters: {
    liquidityFloorUsd: number;
    stressLookbackDays: number;
    scoreWeights: {
      dip: number;
      trend: number;
      macroAlignment: number;
      confirmation: number;
      yieldSupport: number;
      aiStructural: number;
      liquidity: number;
    };
  };
  macro: MacroSnapshot;
  marketDecision: MarketDecisionSnapshot;
  ranked: ReitRecommendation[];
  recommendations: ReitRecommendation[];
  tail: ReitRecommendation[];
  notes: string[];
};

export type ReitHistoryPoint = {
  date: string;
  generatedAt: string;
  riskGate: number;
  msiLevel: number;
  topTicker: string | null;
  topScore: number | null;
};

export type ReitHistory = {
  updatedAt: string;
  points: ReitHistoryPoint[];
};
