export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => {
      const d = v - m;
      return acc + d * d;
    }, 0) / values.length;
  return Math.sqrt(variance);
}

export function zScore(value: number, values: number[]): number {
  const sigma = stdDev(values);
  if (sigma === 0) return 0;
  return (value - mean(values)) / sigma;
}

export function percentile(value: number, values: number[]): number {
  if (!values.length) return 0.5;
  const lessOrEqual = values.filter((v) => v <= value).length;
  return lessOrEqual / values.length;
}

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function rollingMean(values: number[], window: number, endIndex: number): number {
  if (window <= 0 || endIndex < 0) return 0;
  const start = Math.max(0, endIndex - window + 1);
  const slice = values.slice(start, endIndex + 1);
  return mean(slice);
}

export function rollingMedian(values: number[], window: number, endIndex: number): number {
  if (window <= 0 || endIndex < 0) return 0;
  const start = Math.max(0, endIndex - window + 1);
  return median(values.slice(start, endIndex + 1));
}

export function safeDivide(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function scoreByRank(values: number[], direction: "higher" | "lower"): number[] {
  const enriched = values.map((value, index) => ({ value, index }));
  const valid = enriched.filter((item) => Number.isFinite(item.value));

  valid.sort((a, b) => {
    if (direction === "higher") {
      return b.value - a.value;
    }
    return a.value - b.value;
  });

  const result = new Array(values.length).fill(0);

  if (valid.length === 1) {
    result[valid[0]!.index] = 1;
    return result;
  }

  for (let i = 0; i < valid.length; i += 1) {
    const unit = 1 - i / (valid.length - 1);
    result[valid[i]!.index] = unit;
  }

  return result;
}

export function linearRegressionBeta(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;

  const xs = x.slice(-n);
  const ys = y.slice(-n);
  const meanX = mean(xs);
  const meanY = mean(ys);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    numerator += dx * (ys[i]! - meanY);
    denominator += dx * dx;
  }

  return safeDivide(numerator, denominator);
}
