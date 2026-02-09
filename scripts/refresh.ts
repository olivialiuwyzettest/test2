import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { allBrands, brandConfig } from "../config/brands";
import {
  DailyRollupSchema,
  EnrichedMentionSchema,
  History30dSchema,
  LatestSchema,
  MentionSchema,
  type DailyRollup,
  type EnrichedMention,
  type History30d,
  type Latest,
  type Mention,
} from "../lib/schema";
import { computeDailyRollup } from "../lib/rollup";
import { formatDateInTimeZone, subtractHours } from "../lib/time";
import { getConnector, listConnectorNames } from "./connectors";
import { enrichMention } from "./enrich";
import { matchBrandsInText } from "./brand-match";
import { writeJsonIfChanged } from "./utils/write";

function repoPath(...segments: string[]) {
  return path.join(process.cwd(), ...segments);
}

function splitCsv(input: string | undefined) {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadSampleMentionsRebased(end: Date): Promise<Mention[]> {
  const file = repoPath("data", "sample_mentions.json");
  const json = await readJsonFile(file);
  const mentions = MentionSchema.array().parse(json);

  const max = mentions
    .map((m) => new Date(m.publishedAt).getTime())
    .reduce((a, b) => Math.max(a, b), 0);
  const shiftMs = end.getTime() - max;
  return mentions.map((m) => ({
    ...m,
    publishedAt: new Date(new Date(m.publishedAt).getTime() + shiftMs).toISOString(),
  }));
}

async function readLatestIfExists(): Promise<Latest | null> {
  const file = repoPath("public", "data", "latest.json");
  try {
    const json = await readJsonFile(file);
    return LatestSchema.parse(json);
  } catch {
    return null;
  }
}

async function readMentionsCache(): Promise<Map<string, EnrichedMention>> {
  const file = repoPath("public", "data", "mentions_latest.json");
  try {
    const json = await readJsonFile(file);
    const mentions = EnrichedMentionSchema.array().parse(json);
    return new Map(mentions.map((m) => [m.id, m]));
  } catch {
    return new Map();
  }
}

async function readHistoryIfExists(): Promise<History30d | null> {
  const file = repoPath("public", "data", "history_30d.json");
  try {
    const json = await readJsonFile(file);
    return History30dSchema.parse(json);
  } catch {
    return null;
  }
}

function dedupeMentions(mentions: Mention[]) {
  const byId = new Map<string, Mention>();
  for (const m of mentions) {
    const prev = byId.get(m.id);
    if (!prev) {
      byId.set(m.id, m);
      continue;
    }
    // Keep the latest publishedAt if collisions happen.
    const prevTs = new Date(prev.publishedAt).getTime();
    const nextTs = new Date(m.publishedAt).getTime();
    byId.set(m.id, nextTs >= prevTs ? m : prev);
  }
  return [...byId.values()];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let idx = 0;

  async function runner() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await worker(items[current]!, current);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    runner(),
  );
  await Promise.all(runners);
  return results;
}

function stableGeneratedAt<T extends { generatedAt: string }>(
  prev: T | null,
  next: T,
  strip: (v: T) => unknown,
): T {
  if (!prev) return next;
  try {
    const a = JSON.stringify(strip(prev));
    const b = JSON.stringify(strip(next));
    if (a === b) return { ...next, generatedAt: prev.generatedAt };
    return next;
  } catch {
    return next;
  }
}

async function main() {
  const timeZone = process.env.TIMEZONE || "America/Los_Angeles";
  const now = new Date();
  const end = now;
  const start = subtractHours(end, 24);
  const yesterdayStart = subtractHours(start, 24);

  const connectorNames = splitCsv(process.env.DATA_CONNECTORS).length
    ? splitCsv(process.env.DATA_CONNECTORS)
    : ["sample"];

  const forceSample =
    process.env.FORCE_SAMPLE === "1" || process.env.FORCE_SAMPLE === "true";

  const openAiKey = process.env.OPENAI_API_KEY;
  const useOpenAI = Boolean(openAiKey) && !forceSample;

  const sampleOnly =
    connectorNames.length === 1 && connectorNames[0] === "sample";

  if (!openAiKey && connectorNames.some((c) => c !== "sample") && !forceSample) {
    throw new Error(
      "OPENAI_API_KEY is required when using non-sample connectors. " +
        "Either set OPENAI_API_KEY or run `pnpm refresh-data:sample`.",
    );
  }

  const unknown = connectorNames.filter((n) => !getConnector(n));
  if (unknown.length) {
    throw new Error(
      `Unknown connector(s): ${unknown.join(", ")}. Available: ${listConnectorNames().join(", ")}`,
    );
  }

  const ctx = { start, end, timeZone };
  const mentionsByConnector = await Promise.all(
    connectorNames.map(async (name) => {
      const connector = getConnector(name);
      if (!connector) return [];
      const mentions = await connector.getMentions(ctx);
      return MentionSchema.array().parse(mentions);
    }),
  );

  const todayMentions = dedupeMentions(mentionsByConnector.flat()).map((m) => {
    if (m.matchedBrand && m.matchedBrand !== "unknown") return m;
    return { ...m, ...matchBrandsInText(m.text) };
  });

  const prevLatest = await readLatestIfExists();
  let baselineYesterday: DailyRollup | null =
    prevLatest && prevLatest.today?.date
      ? prevLatest.today.date === formatDateInTimeZone(now, timeZone)
        ? prevLatest.yesterday
        : prevLatest.today
      : null;

  const openaiClient = useOpenAI ? new OpenAI({ apiKey: openAiKey }) : undefined;
  const cache = await readMentionsCache();

  // In sample mode, compute a real \"yesterday\" baseline from the prior 24h window
  // so the dashboard shows meaningful deltas out-of-the-box.
  if (sampleOnly && (!baselineYesterday || forceSample || !useOpenAI)) {
    const allSample = await loadSampleMentionsRebased(end);
    const yesterdayWindow = allSample.filter((m) => {
      const ts = new Date(m.publishedAt).getTime();
      return ts >= yesterdayStart.getTime() && ts < start.getTime();
    });
    const yMentions = dedupeMentions(yesterdayWindow).map((m) => {
      if (m.matchedBrand && m.matchedBrand !== "unknown") return m;
      return { ...m, ...matchBrandsInText(m.text) };
    });

    const yEnriched = await mapWithConcurrency(yMentions, 10, async (m) => {
      const cached = cache.get(m.id);
      const isCacheUsable =
        cached &&
        cached.text === m.text &&
        cached.matchedBrand !== "unknown" &&
        cached.sentimentLabel !== "unknown";
      if (isCacheUsable) return cached;
      return enrichMention(m, { useOpenAI: false });
    });

    const yRollup = computeDailyRollup({
      enrichedMentions: yEnriched,
      timeZone,
      now: start,
      yesterday: null,
    });
    baselineYesterday = yRollup;
  }

  const enrichedMentions = await mapWithConcurrency(
    todayMentions,
    useOpenAI ? 4 : 10,
    async (m) => {
      const cached = cache.get(m.id);
      const isCacheUsable =
        cached &&
        cached.text === m.text &&
        cached.matchedBrand !== "unknown" &&
        cached.sentimentLabel !== "unknown";
      if (isCacheUsable) return cached;
      return enrichMention(m, { useOpenAI, client: openaiClient });
    },
  );

  enrichedMentions.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  const todayRollup = computeDailyRollup({
    enrichedMentions,
    timeZone,
    now,
    yesterday: baselineYesterday,
  });

  // Validate runtime shape before persisting.
  DailyRollupSchema.parse(todayRollup);

  const nextLatest: Latest = {
    timezone: timeZone,
    generatedAt: now.toISOString(),
    today: todayRollup,
    yesterday: baselineYesterday,
  };

  const stableLatest = stableGeneratedAt(prevLatest, nextLatest, (v) => ({
    ...v,
    generatedAt: null,
    today: { ...v.today, generatedAt: null },
    yesterday: v.yesterday ? { ...v.yesterday, generatedAt: null } : null,
  }));

  const mentionsOut = enrichedMentions.slice(0, 200);

  const prevHistory = await readHistoryIfExists();
  const rebuildFullHistory =
    sampleOnly && (!useOpenAI || !prevHistory || prevHistory.days.length < 10);

  const nextHistory: History30d = rebuildFullHistory
    ? await (async () => {
        const allSample = await loadSampleMentionsRebased(end);
        const enrichedAll = await mapWithConcurrency(allSample, 12, async (m) => {
          const cached = cache.get(m.id);
          const isCacheUsable =
            cached &&
            cached.text === m.text &&
            cached.matchedBrand !== "unknown" &&
            cached.sentimentLabel !== "unknown";
          if (isCacheUsable) return cached;
          return enrichMention(m, { useOpenAI: false });
        });

        const byDate = new Map<
          string,
          { mentions: number; sumScore: number; dist: { positive: number; neutral: number; negative: number; unknown: number } }
        >();

        for (const m of enrichedAll) {
          const date = formatDateInTimeZone(new Date(m.publishedAt), timeZone);
          const entry =
            byDate.get(date) ??
            { mentions: 0, sumScore: 0, dist: { positive: 0, neutral: 0, negative: 0, unknown: 0 } };
          entry.mentions += 1;
          entry.sumScore += m.sentimentScore;
          if (m.sentimentLabel === "positive") entry.dist.positive += 1;
          else if (m.sentimentLabel === "neutral") entry.dist.neutral += 1;
          else if (m.sentimentLabel === "negative") entry.dist.negative += 1;
          else entry.dist.unknown += 1;
          byDate.set(date, entry);
        }

        const dates = [...byDate.keys()].sort((a, b) => (a < b ? -1 : 1));
        const last30 = dates.slice(-30);

        const days = last30.map((date) => {
          const entry = byDate.get(date)!;
          const avg = entry.mentions ? entry.sumScore / entry.mentions : 0;
          const sentimentIndex = Math.min(100, Math.max(0, Math.round((avg + 1) * 50)));
          return {
            date,
            mentions: entry.mentions,
            sentimentAvg: Math.min(1, Math.max(-1, avg)),
            sentimentIndex,
            sentimentDistribution: entry.dist,
          };
        });

        return {
          timezone: timeZone,
          generatedAt: now.toISOString(),
          days,
        };
      })()
    : (() => {
        const nextDay = {
          date: todayRollup.date,
          mentions: todayRollup.totals.mentions,
          sentimentAvg: todayRollup.sentimentAvg.overall,
          sentimentIndex: todayRollup.sentimentAvg.indexOverall,
          sentimentDistribution: todayRollup.sentimentDistribution.overall,
        };

        const mergedDays = (() => {
          const existing = prevHistory?.days ?? [];
          const map = new Map(existing.map((d) => [d.date, d]));
          map.set(nextDay.date, nextDay);
          return [...map.values()]
            .sort((a, b) => (a.date < b.date ? -1 : 1))
            .slice(-30);
        })();

        return {
          timezone: timeZone,
          generatedAt: now.toISOString(),
          days: mergedDays,
        };
      })();

  const stableHistory = stableGeneratedAt(prevHistory, nextHistory, (v) => ({
    ...v,
    generatedAt: null,
  }));

  const dataDir = repoPath("public", "data");
  await fs.mkdir(dataDir, { recursive: true });

  const latestPath = path.join(dataDir, "latest.json");
  const historyPath = path.join(dataDir, "history_30d.json");
  const mentionsPath = path.join(dataDir, "mentions_latest.json");

  const w1 = await writeJsonIfChanged(latestPath, stableLatest);
  const w2 = await writeJsonIfChanged(historyPath, stableHistory);
  const w3 = await writeJsonIfChanged(mentionsPath, mentionsOut);

  const brands = allBrands(brandConfig);
  const counts = brands.map((b) => `${b}:${todayRollup.totals.mentionsByBrand[b] ?? 0}`);

  // eslint-disable-next-line no-console
  console.log(
    `[wyze-pulse] ${todayRollup.date} mentions=${todayRollup.totals.mentions} ` +
      `sentimentIndex=${todayRollup.sentimentAvg.indexOverall} ` +
      `connectors=${connectorNames.join(",")} ` +
      `openai=${useOpenAI ? "on" : "off"} ` +
      `writes=[latest:${w1.changed ? "yes" : "no"},history:${w2.changed ? "yes" : "no"},mentions:${w3.changed ? "yes" : "no"}] ` +
      `brands=[${counts.join(" ")}]`,
  );
}

main().catch((err) => {
  const msg =
    err instanceof Error
      ? `${err.name}: ${err.message}\n${err.stack ?? ""}`
      : (() => {
          try {
            return JSON.stringify(err, null, 2);
          } catch {
            return String(err);
          }
        })();
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exitCode = 1;
});
