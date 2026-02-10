"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { brandConfig } from "@/config/brands";
import { DistributionBars } from "@/components/charts/distribution-bars";
import { SentimentLineChart } from "@/components/charts/sentiment-line";
import { NewsRotator } from "@/components/tv/news-rotator";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  formatCompactNumber,
  formatInteger,
  formatPercent,
  formatSigned,
  formatTimestamp,
} from "@/lib/format";
import type { EnrichedMention, History30d, Latest } from "@/lib/schema";
import { cn } from "@/lib/ui/cn";

function formatNow(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
}

function Panel(props: {
  title: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border bg-card/60 p-6 shadow-glow backdrop-blur-sm",
        props.className,
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-base font-semibold tracking-tight">
          {props.title}
        </h2>
        {props.right ? <div>{props.right}</div> : null}
      </div>
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

function BigKpi(props: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/60 p-6 shadow-glow backdrop-blur-sm",
        props.className,
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </div>
      <div
        className={cn(
          "mt-2 font-display text-5xl font-semibold leading-none tracking-tight",
          props.valueClassName,
        )}
      >
        {props.value}
      </div>
      {props.sub ? (
        <div className="mt-2 text-sm text-muted-foreground">{props.sub}</div>
      ) : null}
    </div>
  );
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json() as Promise<unknown>;
}

export function TVDashboard(props: {
  initialLatest: Latest;
  initialHistory: History30d;
  initialMentions: EnrichedMention[];
  refreshIntervalMs?: number;
}) {
  const refreshIntervalMs = props.refreshIntervalMs ?? 5 * 60 * 1000;

  const [latest, setLatest] = useState<Latest>(props.initialLatest);
  const [history, setHistory] = useState<History30d>(props.initialHistory);
  const [mentions, setMentions] = useState<EnrichedMention[]>(
    props.initialMentions,
  );
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const bust = Date.now();
        const [nextLatest, nextHistory, nextMentions] = await Promise.all([
          fetchJson(`/data/latest.json?ts=${bust}`),
          fetchJson(`/data/history_30d.json?ts=${bust}`),
          fetchJson(`/data/mentions_latest.json?ts=${bust}`),
        ]);

        const l = nextLatest as Partial<Latest>;
        const h = nextHistory as Partial<History30d>;
        const m = nextMentions as unknown[];

        if (cancelled) return;

        // Lightweight shape checks (avoid importing zod into the TV bundle).
        if (
          typeof l?.today?.sentimentAvg?.indexOverall === "number" &&
          typeof l?.today?.totals?.mentions === "number" &&
          Array.isArray(h?.days) &&
          Array.isArray(m)
        ) {
          setLatest(l as Latest);
          setHistory(h as History30d);
          setMentions(m as EnrichedMention[]);
        }
      } catch {
        // Ignore refresh failures; keep rendering last-known-good.
      }
    };

    // Initial background refresh (in case the server-rendered data is cached).
    void tick();

    const interval = setInterval(() => void tick(), refreshIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshIntervalMs]);

  const { today, yesterday } = latest;

  const sentimentIndex = today.sentimentAvg.indexOverall;
  const sentimentDelta = yesterday
    ? sentimentIndex - yesterday.sentimentAvg.indexOverall
    : null;

  const mentionsCount = today.totals.mentions;
  const mentionsDelta = yesterday ? mentionsCount - yesterday.totals.mentions : null;

  const wyzeMentions = today.totals.mentionsByBrand[brandConfig.primary] ?? 0;
  const shareOfVoiceWyze = mentionsCount ? wyzeMentions / mentionsCount : 0;

  const alert = today.alerts.negativeSpike || today.alerts.mentionSpike;
  const lastUpdated = formatTimestamp(latest.generatedAt, latest.timezone);
  const sourcesSummary = Object.entries(today.totals.mentionsBySource ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${source} ${formatInteger(count)}`)
    .join(" • ");

  const topDrivers = useMemo(() => {
    return {
      negative: today.driversNegative.slice(0, 3),
      positive: today.driversPositive.slice(0, 3),
    };
  }, [today.driversNegative, today.driversPositive]);

  return (
    <main className="min-h-dvh w-full px-6 pb-10 pt-6 lg:px-10 lg:pt-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              Wyze Pulse
            </h1>
            <Badge
              variant={alert ? "danger" : "success"}
              className="px-3 py-1 text-sm"
            >
              {alert ? "ALERT" : "STABLE"}
            </Badge>
            <Badge variant="outline" className="px-3 py-1 text-sm">
              TV
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: <span className="text-foreground">{lastUpdated}</span>{" "}
            <span className="text-muted-foreground">({latest.timezone})</span>{" "}
            <span className="text-muted-foreground/60">|</span>{" "}
            <span className="text-foreground">
              Now: {formatNow(now, latest.timezone)}
            </span>
            {sourcesSummary ? (
              <>
                {" "}
                <span className="text-muted-foreground/60">|</span>{" "}
                <span className="text-foreground">Sources: {sourcesSummary}</span>
              </>
            ) : null}
          </p>
          {alert && today.alerts.reasons.length ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-300">
              {today.alerts.reasons.slice(0, 2).join(" ")}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Dashboard</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/methodology">Methodology</Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <div className="mt-6 grid grid-cols-12 gap-5">
        <section className="col-span-12 grid grid-cols-2 gap-4 xl:col-span-4">
          <BigKpi
            label="Sentiment (0-100)"
            value={sentimentIndex}
            sub={
              <span className="inline-flex items-center gap-2">
                <span className="text-muted-foreground">avg</span>
                <span className="font-mono text-[13px]">
                  {today.sentimentAvg.overall.toFixed(2)}
                </span>
              </span>
            }
            valueClassName={
              sentimentIndex >= 60
                ? "text-emerald-600 dark:text-emerald-300"
                : sentimentIndex <= 40
                  ? "text-red-600 dark:text-red-300"
                  : ""
            }
          />
          <BigKpi
            label="Delta vs Yesterday"
            value={
              yesterday ? (
                <span>{formatSigned(sentimentDelta ?? 0, " pts")}</span>
              ) : (
                "N/A"
              )
            }
            sub={
              yesterday
                ? `Yesterday: ${yesterday.sentimentAvg.indexOverall}`
                : "No baseline yet"
            }
            valueClassName={
              !yesterday
                ? ""
                : (sentimentDelta ?? 0) > 0
                  ? "text-emerald-600 dark:text-emerald-300"
                  : (sentimentDelta ?? 0) < 0
                    ? "text-red-600 dark:text-red-300"
                    : ""
            }
          />
          <BigKpi
            label="Mentions (24h)"
            value={formatCompactNumber(mentionsCount)}
            sub={
              yesterday && mentionsDelta !== null
                ? `${formatSigned(mentionsDelta)} vs yesterday`
                : "N/A"
            }
          />
          <BigKpi
            label={`Share of Voice (${brandConfig.primary})`}
            value={formatPercent(shareOfVoiceWyze, 0)}
            sub={`${formatInteger(wyzeMentions)} of ${formatInteger(mentionsCount)}`}
          />
        </section>

        <section className="col-span-12 space-y-5 xl:col-span-5">
          <Panel
            title="Sentiment Trend (30d)"
            right={
              <div className="text-xs text-muted-foreground">
                Index scale: 0–100
              </div>
            }
          >
            <SentimentLineChart days={history.days} className="h-80" />
          </Panel>
          <Panel title="Sentiment Mix (Today vs Yesterday)">
            <DistributionBars
              today={today.sentimentDistribution.overall}
              yesterday={yesterday ? yesterday.sentimentDistribution.overall : null}
              className="h-44"
            />
          </Panel>
        </section>

        <section className="col-span-12 space-y-5 xl:col-span-3">
          <NewsRotator
            mentions={mentions.slice(0, 40)}
            timeZone={latest.timezone}
            className="min-h-[360px]"
          />

          <Panel title="What Changed (vs Yesterday)">
            <ul className="space-y-3">
              {today.insights.map((insight) => (
                <li key={insight} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <span className="leading-snug">{insight}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Top Drivers">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Negative
                </div>
                <div className="mt-3 space-y-2">
                  {topDrivers.negative.length ? (
                    topDrivers.negative.map((d) => (
                      <div key={d.topic} className="rounded-xl border bg-background/40 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{d.topic}</div>
                          <Badge variant="danger" className="px-2.5 py-1 text-sm">
                            {d.count}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {d.explanation}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">None.</div>
                  )}
                </div>
              </div>

              <Separator />

              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Positive
                </div>
                <div className="mt-3 space-y-2">
                  {topDrivers.positive.length ? (
                    topDrivers.positive.map((d) => (
                      <div key={d.topic} className="rounded-xl border bg-background/40 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{d.topic}</div>
                          <Badge variant="success" className="px-2.5 py-1 text-sm">
                            {d.count}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {d.explanation}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">None.</div>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        </section>

        <section className="col-span-12">
          <Panel
            title="Competitive Landscape"
            right={
              <div className="text-xs text-muted-foreground">
                Share of voice + avg sentiment score (last 24h)
              </div>
            }
          >
            <div className="space-y-3">
              {today.competitorSummary.map((row) => {
                const isPrimary = row.brand === brandConfig.primary;
                const sentiment =
                  row.sentimentAvg >= 0.25
                    ? "text-emerald-600 dark:text-emerald-300"
                    : row.sentimentAvg <= -0.25
                      ? "text-red-600 dark:text-red-300"
                      : "text-muted-foreground";
                const deltaColor =
                  row.mentionsDelta > 0
                    ? "text-emerald-600 dark:text-emerald-300"
                    : row.mentionsDelta < 0
                      ? "text-red-600 dark:text-red-300"
                      : "text-muted-foreground";

                return (
                  <div
                    key={row.brand}
                    className={cn(
                      "rounded-xl border bg-background/30 px-4 py-3",
                      isPrimary && "border-primary/40 bg-primary/10",
                    )}
                  >
                    <div className="grid grid-cols-12 items-center gap-3">
                      <div className="col-span-2 font-display text-lg font-semibold">
                        {row.brand}
                      </div>

                      <div className="col-span-6">
                        <div className="h-3 w-full overflow-hidden rounded-full bg-muted/40">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.round(row.share * 1000) / 10}%` }}
                          />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatPercent(row.share, 0)} share
                        </div>
                      </div>

                      <div className="col-span-2 text-right">
                        <div className="text-sm font-medium">
                          {formatCompactNumber(row.mentions)}
                        </div>
                        <div className={cn("text-xs", deltaColor)}>
                          {yesterday ? formatSigned(row.mentionsDelta) : "N/A"}
                        </div>
                      </div>

                      <div className="col-span-2 text-right">
                        <div className={cn("font-mono text-sm", sentiment)}>
                          {row.sentimentAvg.toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          avg sentiment
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}
