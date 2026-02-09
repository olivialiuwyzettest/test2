import OpenAI from "openai";
import { z } from "zod";
import { allBrands, brandConfig } from "../config/brands";
import {
  EnrichedMentionSchema,
  SentimentLabelSchema,
  type EnrichedMention,
  type Mention,
} from "../lib/schema";
import { matchBrandsInText } from "./brand-match";

const ExtractedSchema = z.object({
  matchedBrand: z.string().min(1),
  matchedCompetitors: z.array(z.string().min(1)).default([]),
  sentimentLabel: SentimentLabelSchema,
  sentimentScore: z.number().min(-1).max(1),
  topics: z.array(z.string().min(1)).max(3),
  keyPhrases: z.array(z.string().min(1)).max(5),
  confidence: z.number().min(0).max(1).optional(),
});
type Extracted = z.infer<typeof ExtractedSchema>;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function localEnrich(mention: Mention): Extracted {
  const { matchedBrand, matchedCompetitors } = matchBrandsInText(mention.text);
  const text = mention.text.toLowerCase();

  const positive = [
    "love",
    "great",
    "solid",
    "good",
    "impressed",
    "easy",
    "affordable",
    "value",
    "reliable",
    "fast",
    "smooth",
  ];
  const negative = [
    "hate",
    "awful",
    "terrible",
    "broken",
    "offline",
    "disconnect",
    "lag",
    "issue",
    "problem",
    "refund",
    "cancel",
    "subscription",
    "paywall",
    "price increase",
    "privacy",
    "breach",
    "support",
  ];

  const posHits = positive.reduce((acc, w) => (text.includes(w) ? acc + 1 : acc), 0);
  const negHits = negative.reduce((acc, w) => (text.includes(w) ? acc + 1 : acc), 0);

  const score = clamp((posHits - negHits) / (posHits + negHits + 3), -1, 1);
  const sentimentLabel =
    score >= 0.2 ? "positive" : score <= -0.2 ? "negative" : "neutral";

  const topicRules: Array<{ topic: string; keys: string[] }> = [
    { topic: "Connectivity", keys: ["offline", "disconnect", "wifi", "connection"] },
    { topic: "Subscription / Pricing", keys: ["subscription", "cam plus", "plan", "fee", "price"] },
    { topic: "App / Firmware", keys: ["app", "update", "firmware"] },
    { topic: "AI Detection", keys: ["ai", "detection", "motion", "person detection"] },
    { topic: "Video Quality", keys: ["quality", "night vision", "1080", "2k", "hdr", "video"] },
    { topic: "Battery / Power", keys: ["battery", "solar", "charging", "power"] },
    { topic: "Support", keys: ["support", "customer service", "warranty", "rma"] },
    { topic: "Privacy", keys: ["privacy", "security", "breach"] },
    { topic: "Setup", keys: ["setup", "install", "pairing"] },
  ];

  const topicScores = topicRules
    .map((r) => ({
      topic: r.topic,
      score: r.keys.reduce((acc, k) => (text.includes(k) ? acc + 1 : acc), 0),
      keys: r.keys,
    }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);

  const topics = topicScores.slice(0, 3).map((t) => t.topic);
  if (topics.length === 0) topics.push("General");

  const keyPhrases: string[] = [];
  const phraseCandidates = [
    "camera offline",
    "motion detection",
    "person detection",
    "app update",
    "customer support",
    "price increase",
    "subscription",
    "battery life",
    "night vision",
    "wifi",
  ];
  for (const p of phraseCandidates) {
    if (text.includes(p) && !keyPhrases.includes(p)) keyPhrases.push(p);
    if (keyPhrases.length >= 5) break;
  }

  const confidence = clamp(0.45 + 0.08 * (posHits + negHits) + 0.06 * (topics.length - 1), 0, 0.85);

  return {
    matchedBrand,
    matchedCompetitors,
    sentimentLabel,
    sentimentScore: score,
    topics,
    keyPhrases,
    confidence,
  };
}

function extractOutputText(resp: unknown): string | null {
  const r = resp as any;
  if (typeof r?.output_text === "string" && r.output_text.trim()) return r.output_text;
  if (typeof r?.outputText === "string" && r.outputText.trim()) return r.outputText;

  const output = r?.output;
  if (!Array.isArray(output)) return null;
  const chunks: string[] = [];
  for (const item of output) {
    for (const c of item?.content ?? []) {
      if (c?.type === "output_text" && typeof c?.text === "string") chunks.push(c.text);
      if (c?.type === "text" && typeof c?.text === "string") chunks.push(c.text);
    }
  }
  const joined = chunks.join("\n").trim();
  return joined ? joined : null;
}

async function openAiEnrich(
  client: OpenAI,
  mention: Mention,
  attempt: 1 | 2,
): Promise<Extracted> {
  const brands = allBrands(brandConfig);

  const system =
    "You are an analyst for a public sentiment dashboard. " +
    "Return ONLY valid JSON matching the provided schema. " +
    "Keep topics short (2-3 words). " +
    "Do not include any keys outside the schema.";

  const user =
    `Brands: ${brands.join(", ")}\n` +
    `Text:\n${mention.text}\n\n` +
    "Task: Determine which brand is primarily discussed (matchedBrand) and which other brands are mentioned (matchedCompetitors). " +
    "Then extract sentiment (label + score -1..1), up to 3 topics, and up to 5 key phrases.";

  const schema = {
    name: "mention_enrichment",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        matchedBrand: { type: "string" },
        matchedCompetitors: { type: "array", items: { type: "string" } },
        sentimentLabel: {
          type: "string",
          enum: ["positive", "neutral", "negative", "unknown"],
        },
        sentimentScore: { type: "number", minimum: -1, maximum: 1 },
        topics: { type: "array", items: { type: "string" }, maxItems: 3 },
        keyPhrases: { type: "array", items: { type: "string" }, maxItems: 5 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: [
        "matchedBrand",
        "matchedCompetitors",
        "sentimentLabel",
        "sentimentScore",
        "topics",
        "keyPhrases",
      ],
    },
  } as const;

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const temperature = attempt === 1 ? 0.2 : 0;

  const resp = await client.responses.create({
    model,
    temperature,
    input: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          attempt === 1
            ? user
            : `${user}\n\nIMPORTANT: Output must be strict JSON. No markdown. No commentary.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        ...schema,
      } as any,
    },
  } as any);

  const textOut = extractOutputText(resp);
  if (!textOut) {
    throw new Error("OpenAI response had no text output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    // Sometimes the model returns JSON surrounded by whitespace; try a tighter extraction.
    const trimmed = textOut.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } else {
      throw new Error("Failed to parse OpenAI JSON output.");
    }
  }

  return ExtractedSchema.parse(parsed);
}

export type EnrichOptions = {
  useOpenAI: boolean;
  client?: OpenAI;
};

export async function enrichMention(
  mention: Mention,
  opts: EnrichOptions,
): Promise<EnrichedMention> {
  const baseBrand = mention.matchedBrand && mention.matchedBrand !== "unknown";
  const withMatch = baseBrand
    ? mention
    : {
        ...mention,
        ...matchBrandsInText(mention.text),
      };

  const extracted =
    opts.useOpenAI && opts.client
      ? await (async () => {
          try {
            return await openAiEnrich(opts.client!, withMatch, 1);
          } catch {
            return await openAiEnrich(opts.client!, withMatch, 2);
          }
        })().catch(() => ({
          ...localEnrich(withMatch),
          sentimentLabel: "unknown" as const,
          sentimentScore: 0,
          topics: ["Unknown"],
          keyPhrases: [],
          confidence: 0.1,
        }))
      : localEnrich(withMatch);

  const enriched: EnrichedMention = {
    ...withMatch,
    matchedBrand: extracted.matchedBrand || withMatch.matchedBrand,
    matchedCompetitors: extracted.matchedCompetitors ?? withMatch.matchedCompetitors,
    sentimentLabel: extracted.sentimentLabel,
    sentimentScore: extracted.sentimentScore,
    topics: extracted.topics.length ? extracted.topics : ["General"],
    keyPhrases: extracted.keyPhrases ?? [],
    confidence: extracted.confidence,
  };

  return EnrichedMentionSchema.parse(enriched);
}

