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
  keyReadings: Array<{
    key: string;
    label: string;
    value: number;
    unit?: string;
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
  dd52w: number;
  rsi14: number;
  ret5d: number;
  ret20d: number;
  ret252d: number;
  ma200Slope: number;
  rateBeta: number;
  liqUsd20d: number;
};

export type ReitRecommendation = {
  ticker: string;
  name: string;
  propertyType: PropertyType;
  score: number;
  rank: number;
  signal: "strong_buy" | "buy_dip" | "watch" | "hold_back";
  rationale: string[];
  features: {
    dd52wPct: number;
    rsi14: number;
    ret20dPct: number;
    ret252dPct: number;
    rateBeta: number;
    liqUsd20d: number;
  };
  components: {
    dip: number;
    trend: number;
    macroAlignment: number;
    aiStructural: number;
    liquidity: number;
    recessionTilt: number;
  };
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
      aiStructural: number;
      liquidity: number;
    };
  };
  macro: MacroSnapshot;
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
