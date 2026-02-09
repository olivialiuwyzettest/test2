import { brandConfig, allBrands, normalizeBrandName } from "../config/brands";
import type {
  DailyRollup,
  Driver,
  EnrichedMention,
  SentimentDistribution,
} from "./schema";
import { formatDateInTimeZone } from "./time";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function sentimentToIndex(avgScore: number) {
  return clamp(Math.round((avgScore + 1) * 50), 0, 100);
}

function emptyDist(): SentimentDistribution {
  return { positive: 0, neutral: 0, negative: 0, unknown: 0 };
}

function addDist(dist: SentimentDistribution, label: string) {
  if (label === "positive") dist.positive += 1;
  else if (label === "neutral") dist.neutral += 1;
  else if (label === "negative") dist.negative += 1;
  else dist.unknown += 1;
}

function avg(nums: number[]) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function brandKey(brand: string) {
  const norm = normalizeBrandName(brand);
  const known = allBrands(brandConfig).find(
    (b) => normalizeBrandName(b) === norm,
  );
  return known ?? brand;
}

function topicCounts(mentions: EnrichedMention[]) {
  const counts = new Map<string, number>();
  for (const m of mentions) {
    for (const t of m.topics ?? []) {
      const key = t.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function topicDrivers(
  mentions: EnrichedMention[],
  predicate: (m: EnrichedMention) => boolean,
): Driver[] {
  const bucket = new Map<
    string,
    { count: number; phrases: Map<string, number> }
  >();

  for (const m of mentions) {
    if (!predicate(m)) continue;
    for (const t of m.topics) {
      const key = t.trim();
      if (!key) continue;
      const entry = bucket.get(key) ?? { count: 0, phrases: new Map() };
      entry.count += 1;
      for (const p of m.keyPhrases) {
        const phrase = p.trim();
        if (!phrase) continue;
        entry.phrases.set(phrase, (entry.phrases.get(phrase) ?? 0) + 1);
      }
      bucket.set(key, entry);
    }
  }

  const drivers: Driver[] = [];
  for (const [topic, info] of bucket.entries()) {
    const topPhrase = [...info.phrases.entries()].sort((a, b) => b[1] - a[1])[0];
    const explanation = topPhrase
      ? `Mostly about "${topPhrase[0]}".`
      : "Recurring theme in mentions.";
    drivers.push({ topic, count: info.count, explanation });
  }

  return drivers.sort((a, b) => b.count - a.count).slice(0, 6);
}

function buildInsights(args: {
  todayIndex: number;
  yesterdayIndex: number | null;
  todayMentions: number;
  yesterdayMentions: number | null;
  topTopicsDelta: Array<{ topic: string; delta: number; todayCount: number }>;
  topNegativeDriver: Driver | null;
  topPositiveDriver: Driver | null;
}) {
  const insights: string[] = [];

  const indexDelta =
    args.yesterdayIndex === null ? null : args.todayIndex - args.yesterdayIndex;
  const mentionsDelta =
    args.yesterdayMentions === null
      ? null
      : args.todayMentions - args.yesterdayMentions;

  if (indexDelta !== null) {
    const dir = indexDelta > 0 ? "up" : indexDelta < 0 ? "down" : "flat";
    insights.push(`Sentiment is ${dir} ${Math.abs(indexDelta)} pts vs yesterday.`);
  } else {
    insights.push("First day of data: no yesterday baseline yet.");
  }

  if (mentionsDelta !== null) {
    const dir = mentionsDelta > 0 ? "more" : mentionsDelta < 0 ? "fewer" : "flat";
    insights.push(
      `Volume is ${dir} by ${Math.abs(mentionsDelta)} mentions vs yesterday.`,
    );
  }

  const biggestMove = args.topTopicsDelta
    .filter((t) => Math.abs(t.delta) >= 3)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (biggestMove) {
    const dir = biggestMove.delta > 0 ? "spiked" : "dropped";
    insights.push(`Topic "${biggestMove.topic}" ${dir} (${biggestMove.delta}).`);
  }

  if (insights.length < 3 && args.topNegativeDriver) {
    insights.push(
      `Top drag: "${args.topNegativeDriver.topic}" (${args.topNegativeDriver.count}).`,
    );
  }
  if (insights.length < 3 && args.topPositiveDriver) {
    insights.push(
      `Top lift: "${args.topPositiveDriver.topic}" (${args.topPositiveDriver.count}).`,
    );
  }

  return insights.slice(0, 3);
}

function computeAlerts(args: {
  todayIndex: number;
  yesterdayIndex: number | null;
  todayMentions: number;
  yesterdayMentions: number | null;
  negativeShareToday: number;
  negativeShareYesterday: number | null;
}) {
  const reasons: string[] = [];
  let negativeSpike = false;
  let mentionSpike = false;

  if (args.yesterdayIndex !== null) {
    const delta = args.todayIndex - args.yesterdayIndex;
    if (delta <= -10) {
      negativeSpike = true;
      reasons.push(`Sentiment index down ${Math.abs(delta)} vs yesterday.`);
    }
  }

  if (args.negativeShareYesterday !== null) {
    const delta = args.negativeShareToday - args.negativeShareYesterday;
    if (delta >= 0.15 && args.negativeShareToday >= 0.35) {
      negativeSpike = true;
      reasons.push("Negative share jumped vs yesterday.");
    }
  }

  if (args.yesterdayMentions !== null) {
    if (args.yesterdayMentions >= 10) {
      const ratio = args.todayMentions / Math.max(1, args.yesterdayMentions);
      if (ratio >= 1.6) {
        mentionSpike = true;
        reasons.push("Mention volume spiked vs yesterday.");
      }
    } else if (args.todayMentions >= 25) {
      mentionSpike = true;
      reasons.push("Unusually high volume today.");
    }
  }

  return { negativeSpike, mentionSpike, reasons };
}

export function computeDailyRollup(args: {
  enrichedMentions: EnrichedMention[];
  timeZone: string;
  now: Date;
  yesterday: DailyRollup | null;
}): DailyRollup {
  const { enrichedMentions, timeZone, now, yesterday } = args;
  const brands = allBrands(brandConfig);

  const date = formatDateInTimeZone(now, timeZone);
  const generatedAt = now.toISOString();

  const mentionsByBrand: Record<string, number> = {};
  const scoresByBrand: Record<string, number[]> = {};
  const distByBrand: Record<string, SentimentDistribution> = {};

  for (const b of brands) {
    mentionsByBrand[b] = 0;
    scoresByBrand[b] = [];
    distByBrand[b] = emptyDist();
  }

  const overallDist = emptyDist();
  const allScores: number[] = [];

  for (const m of enrichedMentions) {
    const b = brandKey(m.matchedBrand);
    if (mentionsByBrand[b] === undefined) {
      // Keep unknown brands out of primary dashboard; they can still appear in drilldown.
      continue;
    }
    mentionsByBrand[b] += 1;
    allScores.push(m.sentimentScore);
    scoresByBrand[b].push(m.sentimentScore);
    addDist(overallDist, m.sentimentLabel);
    addDist(distByBrand[b], m.sentimentLabel);
  }

  const totalMentions = Object.values(mentionsByBrand).reduce((a, b) => a + b, 0);
  const overallAvg = totalMentions ? avg(allScores) : 0;

  const byBrandAvg: Record<string, number> = {};
  for (const b of brands) {
    byBrandAvg[b] = mentionsByBrand[b] ? avg(scoresByBrand[b]) : 0;
  }

  const todayTopicCounts = topicCounts(enrichedMentions);
  const yesterdayTopicCounts = yesterday
    ? new Map(yesterday.topicsTop.map((t) => [t.topic, t.count] as const))
    : new Map<string, number>();
  const topicsTop = [...todayTopicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic, count]) => ({
      topic,
      count,
      deltaVsYesterday: yesterday ? count - (yesterdayTopicCounts.get(topic) ?? 0) : undefined,
    }));

  const driversNegative = topicDrivers(
    enrichedMentions,
    (m) => m.sentimentScore <= -0.25,
  );
  const driversPositive = topicDrivers(
    enrichedMentions,
    (m) => m.sentimentScore >= 0.25,
  );

  const shareOfVoiceByBrand = brands
    .map((brand) => ({
      brand,
      mentions: mentionsByBrand[brand],
      share: totalMentions ? mentionsByBrand[brand] / totalMentions : 0,
    }))
    .sort((a, b) => b.mentions - a.mentions);

  const yesterdayByBrand =
    yesterday?.totals?.mentionsByBrand ?? ({} as Record<string, number>);
  const yesterdayByBrandAvg = yesterday?.sentimentAvg?.byBrand ?? {};

  const competitorSummary = shareOfVoiceByBrand.map((item) => {
    const yMentions = yesterdayByBrand[item.brand] ?? 0;
    const yAvg = yesterdayByBrandAvg[item.brand] ?? 0;
    const sAvg = byBrandAvg[item.brand] ?? 0;
    return {
      brand: item.brand,
      mentions: item.mentions,
      share: item.share,
      sentimentAvg: sAvg,
      mentionsDelta: item.mentions - yMentions,
      sentimentDelta: clamp(sAvg - yAvg, -1, 1),
    };
  });

  const yesterdayIndex = yesterday ? yesterday.sentimentAvg.indexOverall : null;
  const yesterdayMentions = yesterday ? yesterday.totals.mentions : null;

  const topTopicsDelta = topicsTop
    .map((t) => ({
      topic: t.topic,
      delta: t.deltaVsYesterday ?? 0,
      todayCount: t.count,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const negativeShareToday = totalMentions
    ? overallDist.negative / totalMentions
    : 0;
  const negativeShareYesterday =
    yesterday && yesterday.totals.mentions
      ? yesterday.sentimentDistribution.overall.negative / yesterday.totals.mentions
      : null;

  const alerts = computeAlerts({
    todayIndex: sentimentToIndex(overallAvg),
    yesterdayIndex,
    todayMentions: totalMentions,
    yesterdayMentions,
    negativeShareToday,
    negativeShareYesterday,
  });

  const insights = buildInsights({
    todayIndex: sentimentToIndex(overallAvg),
    yesterdayIndex,
    todayMentions: totalMentions,
    yesterdayMentions,
    topTopicsDelta,
    topNegativeDriver: driversNegative[0] ?? null,
    topPositiveDriver: driversPositive[0] ?? null,
  });

  return {
    date,
    timezone: timeZone,
    generatedAt,
    totals: {
      mentions: totalMentions,
      mentionsByBrand,
    },
    sentimentAvg: {
      overall: clamp(overallAvg, -1, 1),
      indexOverall: sentimentToIndex(overallAvg),
      byBrand: byBrandAvg,
    },
    sentimentDistribution: {
      overall: overallDist,
      byBrand: distByBrand,
    },
    topicsTop,
    driversPositive,
    driversNegative,
    shareOfVoiceByBrand,
    competitorSummary,
    insights,
    alerts,
  };
}
