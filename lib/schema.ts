import { z } from "zod";

export const MentionSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  publishedAt: z.string().datetime(),
  url: z.string().url(),
  author: z.string().min(1).nullable().optional(),
  text: z.string().min(1),
  matchedBrand: z.string().min(1),
  matchedCompetitors: z.array(z.string().min(1)).default([]),
  rawMeta: z.record(z.unknown()).optional(),
});
export type Mention = z.infer<typeof MentionSchema>;

export const SentimentLabelSchema = z.enum([
  "positive",
  "neutral",
  "negative",
  "unknown",
]);
export type SentimentLabel = z.infer<typeof SentimentLabelSchema>;

export const EnrichedMentionSchema = MentionSchema.extend({
  sentimentLabel: SentimentLabelSchema,
  sentimentScore: z.number().min(-1).max(1),
  topics: z.array(z.string().min(1)).max(3),
  keyPhrases: z.array(z.string().min(1)).max(5),
  confidence: z.number().min(0).max(1).optional(),
});
export type EnrichedMention = z.infer<typeof EnrichedMentionSchema>;

export const SentimentDistributionSchema = z.object({
  positive: z.number().int().nonnegative(),
  neutral: z.number().int().nonnegative(),
  negative: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});
export type SentimentDistribution = z.infer<typeof SentimentDistributionSchema>;

export const DriverSchema = z.object({
  topic: z.string().min(1),
  count: z.number().int().nonnegative(),
  explanation: z.string().min(1),
});
export type Driver = z.infer<typeof DriverSchema>;

export const TopicCountSchema = z.object({
  topic: z.string().min(1),
  count: z.number().int().nonnegative(),
  deltaVsYesterday: z.number().int().optional(),
});
export type TopicCount = z.infer<typeof TopicCountSchema>;

export const ShareOfVoiceItemSchema = z.object({
  brand: z.string().min(1),
  mentions: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
});
export type ShareOfVoiceItem = z.infer<typeof ShareOfVoiceItemSchema>;

export const CompetitorSummaryItemSchema = z.object({
  brand: z.string().min(1),
  mentions: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
  sentimentAvg: z.number().min(-1).max(1),
  mentionsDelta: z.number().int(),
  sentimentDelta: z.number().min(-1).max(1),
});
export type CompetitorSummaryItem = z.infer<typeof CompetitorSummaryItemSchema>;

export const AlertsSchema = z.object({
  negativeSpike: z.boolean(),
  mentionSpike: z.boolean(),
  reasons: z.array(z.string().min(1)),
});
export type Alerts = z.infer<typeof AlertsSchema>;

export const DailyRollupSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  generatedAt: z.string().datetime(),
  totals: z.object({
    mentions: z.number().int().nonnegative(),
    mentionsByBrand: z.record(z.number().int().nonnegative()),
    mentionsBySource: z.record(z.number().int().nonnegative()).default({}),
    // Only populated when a connector provides subreddit metadata (e.g., Reddit).
    mentionsBySubreddit: z.record(z.number().int().nonnegative()).default({}),
  }),
  sentimentAvg: z.object({
    overall: z.number().min(-1).max(1),
    indexOverall: z.number().min(0).max(100),
    byBrand: z.record(z.number().min(-1).max(1)),
  }),
  sentimentDistribution: z.object({
    overall: SentimentDistributionSchema,
    byBrand: z.record(SentimentDistributionSchema),
  }),
  topicsTop: z.array(TopicCountSchema),
  driversPositive: z.array(DriverSchema),
  driversNegative: z.array(DriverSchema),
  shareOfVoiceByBrand: z.array(ShareOfVoiceItemSchema),
  competitorSummary: z.array(CompetitorSummaryItemSchema),
  insights: z.array(z.string().min(1)).max(3),
  alerts: AlertsSchema,
});
export type DailyRollup = z.infer<typeof DailyRollupSchema>;

export const HistoryDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mentions: z.number().int().nonnegative(),
  sentimentAvg: z.number().min(-1).max(1),
  sentimentIndex: z.number().min(0).max(100),
  sentimentDistribution: SentimentDistributionSchema,
});
export type HistoryDay = z.infer<typeof HistoryDaySchema>;

export const History30dSchema = z.object({
  timezone: z.string().min(1),
  generatedAt: z.string().datetime(),
  days: z.array(HistoryDaySchema).max(30),
});
export type History30d = z.infer<typeof History30dSchema>;

export const LatestSchema = z.object({
  timezone: z.string().min(1),
  generatedAt: z.string().datetime(),
  today: DailyRollupSchema,
  yesterday: DailyRollupSchema.nullable(),
});
export type Latest = z.infer<typeof LatestSchema>;
