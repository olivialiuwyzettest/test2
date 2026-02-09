export function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${(amount).toFixed(0)}`;
  }
}

export function formatPercent(pct: number, digits = 0): string {
  return `${(pct * 100).toFixed(digits)}%`;
}

