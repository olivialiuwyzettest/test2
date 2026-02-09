import { brandConfig } from "@/config/brands";
import { DistributionBars } from "@/components/charts/distribution-bars";
import { SentimentLineChart } from "@/components/charts/sentiment-line";
import { KpiCard } from "@/components/kpi-card";
import { MentionList } from "@/components/mention-list";
import { SectionHeading } from "@/components/section-heading";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatInteger, formatPercent, formatSigned, formatTimestamp } from "@/lib/format";
import { loadHistory30d, loadLatest, loadMentionsLatest } from "@/lib/data/load";

export default async function HomePage() {
  let latest;
  let history;
  let mentions;

  try {
    [latest, history, mentions] = await Promise.all([
      loadLatest(),
      loadHistory30d(),
      loadMentionsLatest(),
    ]);
  } catch (err) {
    return (
      <main className="container py-10">
        <h1 className="font-display text-2xl font-semibold">Wyze Pulse</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Dashboard data is missing or invalid. Run{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5">pnpm refresh-data:sample</code>{" "}
          to generate sample data.
        </p>
        <pre className="mt-4 overflow-auto rounded-lg border bg-card p-4 text-xs text-muted-foreground">
          {String(err)}
        </pre>
      </main>
    );
  }

  const today = latest.today;
  const yesterday = latest.yesterday;

  const sentimentIndex = today.sentimentAvg.indexOverall;
  const sentimentDelta = yesterday
    ? sentimentIndex - yesterday.sentimentAvg.indexOverall
    : 0;

  const mentionsCount = today.totals.mentions;
  const mentionsDelta = yesterday ? mentionsCount - yesterday.totals.mentions : 0;

  const wyzeMentions = today.totals.mentionsByBrand[brandConfig.primary] ?? 0;
  const shareOfVoiceWyze = mentionsCount ? wyzeMentions / mentionsCount : 0;

  const alert = today.alerts.negativeSpike || today.alerts.mentionSpike;
  const alertLabel = alert ? "Alert" : "Stable";

  const lastUpdated = formatTimestamp(latest.generatedAt, latest.timezone);

  return (
    <main className="container pb-14 pt-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Wyze Pulse
            </h1>
            <Badge variant={alert ? "danger" : "success"}>{alertLabel}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Last updated: <span className="text-foreground">{lastUpdated}</span>{" "}
            <span className="text-muted-foreground">({latest.timezone})</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Sentiment (0-100)"
          value={sentimentIndex}
          sub={
            <span className="inline-flex items-center gap-2">
              <span className="text-muted-foreground">avg</span>
              <span className="font-mono text-[11px]">{today.sentimentAvg.overall.toFixed(2)}</span>
            </span>
          }
          valueClassName={sentimentIndex >= 60 ? "text-emerald-600 dark:text-emerald-300" : sentimentIndex <= 40 ? "text-red-600 dark:text-red-300" : ""}
        />
        <KpiCard
          label="Delta vs Yesterday"
          value={yesterday ? formatSigned(sentimentDelta, " pts") : "N/A"}
          valueClassName={
            !yesterday
              ? ""
              : sentimentDelta > 0
                ? "text-emerald-600 dark:text-emerald-300"
                : sentimentDelta < 0
                  ? "text-red-600 dark:text-red-300"
                  : ""
          }
          sub={
            yesterday
              ? `Yesterday: ${yesterday.sentimentAvg.indexOverall}`
              : "No baseline yet"
          }
        />
        <KpiCard
          label="Mentions (24h)"
          value={formatInteger(mentionsCount)}
          sub={yesterday ? `${formatSigned(mentionsDelta)} vs yesterday` : "N/A"}
        />
        <KpiCard
          label="Share of Voice (Wyze)"
          value={formatPercent(shareOfVoiceWyze, 0)}
          sub={`${formatInteger(wyzeMentions)} of ${formatInteger(mentionsCount)}`}
        />
        <KpiCard
          label="Alerts"
          value={alert ? "ALERT" : "OK"}
          sub={
            alert
              ? today.alerts.reasons.slice(0, 2).join(" ")
              : "No spikes detected."
          }
          valueClassName={alert ? "text-red-600 dark:text-red-300" : "text-emerald-600 dark:text-emerald-300"}
        />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Sentiment Trend (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <SentimentLineChart days={history.days} />
          </CardContent>
        </Card>
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Sentiment Mix (Today vs Yesterday)</CardTitle>
          </CardHeader>
          <CardContent>
            <DistributionBars
              today={today.sentimentDistribution.overall}
              yesterday={yesterday ? yesterday.sentimentDistribution.overall : null}
            />
          </CardContent>
        </Card>
      </section>

      <section className="mt-10">
        <SectionHeading
          title="Competitive Snapshot"
          subtitle="Share of voice + sentiment by brand (last 24h)."
        />
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="animate-fade-up lg:col-span-2">
            <CardHeader>
              <CardTitle>Brands</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                    <TableHead className="text-right">Mentions</TableHead>
                    <TableHead className="text-right">Delta Mentions</TableHead>
                    <TableHead className="text-right">Avg Sentiment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {today.competitorSummary.map((row) => (
                    <TableRow key={row.brand}>
                      <TableCell className="font-medium">{row.brand}</TableCell>
                      <TableCell className="text-right">
                        {formatPercent(row.share, 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatInteger(row.mentions)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            row.mentionsDelta > 0
                              ? "text-emerald-600 dark:text-emerald-300"
                              : row.mentionsDelta < 0
                                ? "text-red-600 dark:text-red-300"
                                : "text-muted-foreground"
                          }
                        >
                          {yesterday ? formatSigned(row.mentionsDelta) : "N/A"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-[12px]">
                          {row.sentimentAvg.toFixed(2)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="animate-fade-up">
            <CardHeader>
              <CardTitle>What changed since yesterday?</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {today.insights.map((insight) => (
                  <li key={insight} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
              {today.topicsTop.length ? (
                <>
                  <Separator className="my-4" />
                  <div className="text-xs text-muted-foreground">
                    Top topics today:
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {today.topicsTop.slice(0, 8).map((t) => (
                      <Badge key={t.topic} variant="outline">
                        {t.topic}{" "}
                        <span className="ml-1 text-muted-foreground">
                          {t.count}
                        </span>
                      </Badge>
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Top Negative Drivers</CardTitle>
          </CardHeader>
          <CardContent>
            {today.driversNegative.length ? (
              <ul className="space-y-3">
                {today.driversNegative.slice(0, 6).map((d) => (
                  <li key={d.topic} className="rounded-md border bg-card/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{d.topic}</div>
                      <Badge variant="danger">{d.count}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {d.explanation}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No strong negative drivers detected.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Top Positive Drivers</CardTitle>
          </CardHeader>
          <CardContent>
            {today.driversPositive.length ? (
              <ul className="space-y-3">
                {today.driversPositive.slice(0, 6).map((d) => (
                  <li key={d.topic} className="rounded-md border bg-card/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{d.topic}</div>
                      <Badge variant="success">{d.count}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {d.explanation}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No strong positive drivers detected.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-10">
        <SectionHeading
          title="Example Mentions"
          subtitle="A capped set of enriched mentions (up to 200) for quick drill-down."
          right={
            <Badge variant="outline">
              Showing {formatInteger(mentions.length)}
            </Badge>
          }
        />
        <div className="mt-4">
          <MentionList mentions={mentions.slice(0, 40)} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Data sources are opt-in. RSS/Reddit connectors are disabled by default.
        </p>
      </section>
    </main>
  );
}
