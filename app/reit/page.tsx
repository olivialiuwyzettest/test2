import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkline } from "@/components/charts/sparkline";
import { ReitSignalCharts } from "@/components/reit/reit-signal-charts";
import { getReitSnapshot } from "@/lib/reit/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function pct(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatYield(value: number | null): string {
  if (value === null) return "n/a";
  return `${value.toFixed(2)}%`;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function signalLabel(signal: string): string {
  if (signal === "strong_buy") return "Strong Buy";
  if (signal === "buy_dip") return "Weak Buy";
  if (signal === "watch") return "Watch";
  return "Hold Back";
}

function signalVariant(signal: string): "success" | "brand" | "neutral" | "danger" {
  if (signal === "strong_buy") return "success";
  if (signal === "buy_dip") return "brand";
  if (signal === "watch") return "neutral";
  return "danger";
}

export default async function ReitDashboardPage() {
  const snapshot = await getReitSnapshot({ forceRefreshIfMissing: true });

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>REIT Dashboard Unavailable</CardTitle>
            <CardDescription>
              No snapshot exists yet. Run `pnpm reit:refresh` or call `/api/cron/reit-refresh`.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const msiPoints = snapshot.macro.msiHistory.map((point) => point.msi);
  const yieldValues = snapshot.ranked
    .map((item) => item.features.dividendYieldPct)
    .filter((value): value is number => value !== null);
  const avgYield = average(yieldValues);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Daily REIT Dip Recommendations</CardTitle>
            <CardDescription>
              Ranked by panic-adjusted score with macro gate, trend filter, liquidity, and AI structural tilt.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Snapshot Date</div>
              <div className="mt-1 text-2xl font-semibold">{snapshot.asOf}</div>
              <div className="mt-1 text-xs text-muted-foreground">Generated {snapshot.generatedAt}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Regime</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant={snapshot.macro.regime === "panic_improving" ? "success" : "neutral"}>
                  {snapshot.macro.regime.replace("_", " ")}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  RiskGate {snapshot.macro.riskGate.toFixed(2)}
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Avg dividend yield (ranked): {formatYield(avgYield)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Macro Stress Index (60d)</CardTitle>
            <CardDescription>
              MSI percentile: {(snapshot.macro.msiLevel * 100).toFixed(1)} | 5d trend:
              {` ${snapshot.macro.msiTrend5d.toFixed(2)}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Sparkline points={msiPoints} width={320} height={64} />
            <div className="mt-3 text-xs text-muted-foreground">
              Recession risk score: {(snapshot.macro.recessionRisk * 100).toFixed(1)}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Signal Charts</CardTitle>
            <CardDescription>
              Visual map of Strong Buy vs Weak Buy vs Watch, plus dividend-yield context.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReitSignalCharts
              points={snapshot.ranked.map((item) => ({
                ticker: item.ticker,
                signal: item.signal,
                score: item.score,
                dd52wPct: item.features.dd52wPct,
                dividendYieldPct: item.features.dividendYieldPct,
              }))}
            />
          </CardContent>
        </Card>
      </section>

      <section className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Top Recommendations</CardTitle>
            <CardDescription>
              Final score = 100 x RiskGate x weighted component blend. Higher score means stronger dip setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">52W Drawdown</TableHead>
                  <TableHead className="text-right">RSI(14)</TableHead>
                  <TableHead className="text-right">20D Return</TableHead>
                  <TableHead className="text-right">252D Return</TableHead>
                  <TableHead className="text-right">Dividend Yield</TableHead>
                  <TableHead className="text-right">Rate Beta</TableHead>
                  <TableHead className="text-right">20D Liquidity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.recommendations.map((row) => (
                  <TableRow key={row.ticker}>
                    <TableCell>{row.rank}</TableCell>
                    <TableCell>
                      <div className="font-semibold">{row.ticker}</div>
                      <div className="text-xs text-muted-foreground">{row.propertyType}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={signalVariant(row.signal)}>{signalLabel(row.signal)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{row.score.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{pct(row.features.dd52wPct)}</TableCell>
                    <TableCell className="text-right">{row.features.rsi14.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{pct(row.features.ret20dPct)}</TableCell>
                    <TableCell className="text-right">{pct(row.features.ret252dPct)}</TableCell>
                    <TableCell className="text-right">
                      {formatYield(row.features.dividendYieldPct)}
                    </TableCell>
                    <TableCell className="text-right">{row.features.rateBeta.toFixed(3)}</TableCell>
                    <TableCell className="text-right">{usd(row.features.liqUsd20d)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Macro Readings</CardTitle>
            <CardDescription>Core regime inputs used in today&apos;s score.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {snapshot.macro.keyReadings.map((reading) => (
              <div key={reading.key} className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{reading.label}</div>
                <div className="mt-1 text-lg font-semibold">
                  {reading.value}
                  {reading.unit ? ` ${reading.unit}` : ""}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decision Notes</CardTitle>
            <CardDescription>Risk controls and gating decisions for this run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {snapshot.notes.length ? (
              snapshot.notes.map((note) => (
                <div key={note} className="rounded-md border p-3 text-muted-foreground">
                  {note}
                </div>
              ))
            ) : (
              <div className="rounded-md border p-3 text-muted-foreground">No additional warnings today.</div>
            )}
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              Research tool only, not investment advice.
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
