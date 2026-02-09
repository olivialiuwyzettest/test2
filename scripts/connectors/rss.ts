import Parser from "rss-parser";
import type { Mention } from "../../lib/schema";
import type { Connector } from "./types";
import { sha256Hex } from "../utils/hash";

const parser = new Parser();

function splitCsv(input: string | undefined) {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const rssConnector: Connector = {
  name: "rss",
  async getMentions(ctx) {
    const feeds = splitCsv(process.env.RSS_FEEDS);
    if (feeds.length === 0) return [];

    const all: Mention[] = [];
    for (const feedUrl of feeds) {
      const feed = await parser.parseURL(feedUrl);
      for (const item of feed.items ?? []) {
        const url = item.link ?? feedUrl;
        const publishedAt =
          item.isoDate ??
          (item.pubDate ? new Date(item.pubDate).toISOString() : null);
        if (!publishedAt) continue;

        const ts = new Date(publishedAt).getTime();
        if (ts < ctx.start.getTime() || ts >= ctx.end.getTime()) continue;

        const text =
          (item.title ? `${item.title}\n\n` : "") +
          (item.contentSnippet ?? item.content ?? "");
        const cleaned = text.trim();
        if (!cleaned) continue;

        all.push({
          id: `rss:${sha256Hex(url).slice(0, 18)}`,
          source: "rss",
          publishedAt: new Date(publishedAt).toISOString(),
          url,
          author: item.creator ?? undefined,
          text: cleaned.slice(0, 1200),
          matchedBrand: "unknown",
          matchedCompetitors: [],
          rawMeta: {
            feedTitle: feed.title,
          },
        });
      }
    }

    return all;
  },
};

