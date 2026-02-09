export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 1) return xs[mid]!;
  return (xs[mid - 1]! + xs[mid]!) / 2;
}

// Returns 0..100 where lower means "cheaper" / closer to min.
export function percentileRank(values: number[], value: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return null;
  if (n === 1) return 50;

  let less = 0;
  let equal = 0;
  for (const v of xs) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }
  // Midrank for ties.
  const rank = less + (equal + 1) / 2; // 1..n
  const pct = (100 * (rank - 1)) / (n - 1);
  return Math.max(0, Math.min(100, pct));
}

