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

function price(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

function signed(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function formatDelta(
  abs: number | null,
  pctChange: number | null,
  unit?: string,
  digits = 2,
): string {
  if (abs === null) return "n/a";
  const absolute = `${signed(abs, digits)}${unit ? ` ${unit}` : ""}`;
  if (pctChange === null) return absolute;
  return `${absolute} (${signed(pctChange, 2)}%)`;
}

function formatMacroValue(value: number, unit?: string): string {
  const digits = Math.abs(value) >= 100 ? 0 : 3;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function cycleLabel(phase: string): string {
  if (phase === "panic_shock") return "Panic Shock";
  if (phase === "late_contraction") return "Late Contraction";
  if (phase === "late_cycle_tightening") return "Late Cycle Tightening";
  if (phase === "mid_cycle_expansion") return "Mid-Cycle Expansion";
  if (phase === "early_recovery") return "Early Recovery";
  return "Transition";
}

function cycleVariant(phase: string): "success" | "brand" | "neutral" | "danger" {
  if (phase === "early_recovery" || phase === "mid_cycle_expansion") return "success";
  if (phase === "transition") return "brand";
  if (phase === "late_cycle_tightening") return "neutral";
  return "danger";
}

function impactVariant(impact: string): "success" | "neutral" | "danger" {
  if (impact === "tailwind") return "success";
  if (impact === "headwind") return "danger";
  return "neutral";
}

function actionLabel(action: string): string {
  if (action === "buy_now") return "Buy Now";
  if (action === "scale_in") return "Scale In";
  if (action === "wait_for_confirmation") return "Wait";
  return "Avoid";
}

function actionVariant(action: string): "success" | "brand" | "neutral" | "danger" {
  if (action === "buy_now") return "success";
  if (action === "scale_in") return "brand";
  if (action === "wait_for_confirmation") return "neutral";
  return "danger";
}

function buyWindowLabel(status: string): string {
  if (status === "open") return "Open";
  if (status === "selective") return "Selective";
  return "Closed";
}

function buyWindowVariant(status: string): "success" | "brand" | "danger" {
  if (status === "open") return "success";
  if (status === "selective") return "brand";
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
  const triggerPlans = snapshot.recommendations.filter((item) => item.action !== "avoid").slice(0, 4);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-6 grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Daily REIT Buy Dashboard</CardTitle>
            <CardDescription>
              Upgraded from ranking-only into a buy-timing tool with market window, conviction, and entry rules.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Snapshot Date</div>
              <div className="mt-1 text-2xl font-semibold">{snapshot.asOf}</div>
              <div className="mt-1 text-xs text-muted-foreground">Generated {snapshot.generatedAt}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Top-Level Rule</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant={buyWindowVariant(snapshot.marketDecision.status)}>
                  {buyWindowLabel(snapshot.marketDecision.status)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Score {snapshot.marketDecision.score.toFixed(1)}
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Avg dividend yield (ranked): {formatYield(avgYield)}
              </div>
            </div>
            <div className="sm:col-span-2 rounded-md border p-3 text-sm text-muted-foreground">
              {snapshot.marketDecision.pullTriggerRule}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Market Buy Window</CardTitle>
            <CardDescription>Macro plus REIT breadth decide whether you should buy at all.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={buyWindowVariant(snapshot.marketDecision.status)}>
                {buyWindowLabel(snapshot.marketDecision.status)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Breadth + macro score {snapshot.marketDecision.score.toFixed(1)} / 100
              </span>
            </div>

            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {snapshot.marketDecision.summary}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Oversold Breadth</div>
                <div className="mt-1 text-lg font-semibold">
                  {snapshot.marketDecision.breadth.oversoldPct.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Positive 5D Breadth</div>
                <div className="mt-1 text-lg font-semibold">
                  {snapshot.marketDecision.breadth.positive5dPct.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Positive Trend Breadth</div>
                <div className="mt-1 text-lg font-semibold">
                  {snapshot.marketDecision.breadth.positiveTrendPct.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Actionable Names</div>
                <div className="mt-1 text-lg font-semibold">
                  {snapshot.marketDecision.breadth.buyNowCount + snapshot.marketDecision.breadth.scaleInCount}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Macro Stress Index</CardTitle>
            <CardDescription>
              MSI percentile {(snapshot.macro.msiLevel * 100).toFixed(1)} | 5D trend{" "}
              {snapshot.macro.msiTrend5d.toFixed(2)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Sparkline points={msiPoints} width={320} height={64} />
            <div className="mt-4 flex items-center gap-2">
              <Badge variant={buyWindowVariant(snapshot.macro.buyWindowStatus)}>
                Macro {buyWindowLabel(snapshot.macro.buyWindowStatus)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Score {snapshot.macro.buyWindowScore.toFixed(1)} / 100
              </span>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Recession risk score: {(snapshot.macro.recessionRisk * 100).toFixed(1)} | RiskGate{" "}
              {snapshot.macro.riskGate.toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mb-6 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Macro Cycle Lens</CardTitle>
            <CardDescription>
              Translating macro numbers into cycle context and REIT purchase actions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={cycleVariant(snapshot.macro.cyclePhase)}>
                {cycleLabel(snapshot.macro.cyclePhase)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Cycle score {snapshot.macro.cycleScore.toFixed(1)} / 100
              </span>
              <Badge variant={buyWindowVariant(snapshot.macro.buyWindowStatus)}>
                Macro {buyWindowLabel(snapshot.macro.buyWindowStatus)}
              </Badge>
            </div>

            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {snapshot.macro.macroSummary}
            </div>

            <div className="grid gap-2">
              {snapshot.macro.decisionPlaybook.map((step) => (
                <div key={step} className="rounded-md border p-3 text-sm text-muted-foreground">
                  {step}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pull Trigger Checklist</CardTitle>
            <CardDescription>Use this before buying any REIT on the list.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-md border p-3 text-muted-foreground">
              {snapshot.macro.buyWindowSummary}
            </div>
            {snapshot.marketDecision.checklist.map((item) => (
              <div key={item} className="rounded-md border p-3 text-muted-foreground">
                {item}
              </div>
            ))}
            {snapshot.macro.pullTriggerChecklist.map((item) => (
              <div key={item} className="rounded-md border p-3 text-muted-foreground">
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Signal Charts</CardTitle>
            <CardDescription>
              Visual map of conviction, timing, and which names are ready now versus still on watch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReitSignalCharts
              points={snapshot.ranked.map((item) => ({
                ticker: item.ticker,
                action: item.action,
                score: item.score,
                conviction: item.conviction,
                timingScore: item.timingScore,
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
            <CardTitle>Pull Trigger Plans</CardTitle>
            <CardDescription>
              Concrete execution rules for the best current setups. Starter size is a share of your target position.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {(triggerPlans.length ? triggerPlans : snapshot.recommendations.slice(0, 4)).map((row) => (
              <div key={row.ticker} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{row.ticker}</div>
                    <div className="text-xs text-muted-foreground">{row.name}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={actionVariant(row.action)}>{actionLabel(row.action)}</Badge>
                    <span className="text-sm text-muted-foreground">
                      Conviction {row.conviction.toFixed(1)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Score</div>
                    <div className="mt-1 text-lg font-semibold">{row.score.toFixed(1)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Timing</div>
                    <div className="mt-1 text-lg font-semibold">{row.timingScore.toFixed(1)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Current Price</div>
                    <div className="mt-1 text-lg font-semibold">{price(row.features.lastClose)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Dividend Yield</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatYield(row.features.dividendYieldPct)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
                  {row.decisionSummary}
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Buy</div>
                    <div className="mt-1">{row.entryPlan.buyRule}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Add</div>
                    <div className="mt-1">{row.entryPlan.addRule}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Abort</div>
                    <div className="mt-1">{row.entryPlan.abortRule}</div>
                  </div>
                </div>

                {row.blockers.length ? (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                    {row.blockers.join(" ")}
                  </div>
                ) : null}

                {row.upgradeTriggers.length ? (
                  <div className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">
                    {row.upgradeTriggers.join(" ")}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Macro Momentum (DoD / MoM / YoY)</CardTitle>
            <CardDescription>
              Each indicator includes direction, whether that is good or bad for REITs, and why it matters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indicator</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">DoD</TableHead>
                  <TableHead className="text-right">MoM</TableHead>
                  <TableHead className="text-right">YoY</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>Interpretation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.macro.indicators.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell className="font-medium">{item.label}</TableCell>
                    <TableCell className="text-right">
                      {formatMacroValue(item.value, item.unit)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDelta(item.dod, item.dodPct, item.unit)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDelta(item.mom, item.momPct, item.unit)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDelta(item.yoy, item.yoyPct, item.unit)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={impactVariant(item.reitImpact)}>{item.reitImpact}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.interpretation}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Actionable Ranking</CardTitle>
            <CardDescription>
              Composite score combines dip quality, trend, rate alignment, entry confirmation, yield support, and risk controls.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Conviction</TableHead>
                  <TableHead className="text-right">Timing</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">5D</TableHead>
                  <TableHead className="text-right">52W DD</TableHead>
                  <TableHead className="text-right">Yield</TableHead>
                  <TableHead className="text-right">Starter</TableHead>
                  <TableHead>Summary</TableHead>
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
                      <Badge variant={actionVariant(row.action)}>{actionLabel(row.action)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{row.conviction.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{row.timingScore.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{price(row.features.lastClose)}</TableCell>
                    <TableCell className="text-right">{pct(row.features.ret5dPct)}</TableCell>
                    <TableCell className="text-right">{pct(row.features.dd52wPct)}</TableCell>
                    <TableCell className="text-right">{formatYield(row.features.dividendYieldPct)}</TableCell>
                    <TableCell className="text-right">{row.entryPlan.starterSizePct}%</TableCell>
                    <TableCell className="text-muted-foreground">{row.decisionSummary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
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
            <CardDescription>Risk controls and warnings for this run.</CardDescription>
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
