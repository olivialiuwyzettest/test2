import type { Mention } from "../../lib/schema";
import type { Connector } from "./types";
import { allBrands, brandConfig } from "../../config/brands";

type RedditTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
};

type RedditPost = {
  id: string;
  name: string;
  created_utc: number;
  permalink: string;
  url: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  score: number;
  num_comments: number;
};

type RedditSearchResponse = {
  data: {
    children: Array<{
      kind: string;
      data: {
        id: string;
        name: string;
        created_utc: number;
        permalink: string;
        url: string;
        title: string;
        selftext: string;
        author: string;
        subreddit: string;
        score: number;
        num_comments: number;
      };
    }>;
  };
};

type RedditListingResponse = {
  data: {
    children: Array<{
      kind: string;
      data: RedditPost;
    }>;
  };
};

function splitCsv(input: string | undefined) {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getRedditAccessToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const refresh = process.env.REDDIT_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refresh);

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "wyze-pulse/0.1 (by u/wyze-pulse-bot)",
    },
    body,
  });
  if (!res.ok) return null;
  return (await res.json()) as RedditTokenResponse;
}

function defaultQuery() {
  const brands = allBrands(brandConfig);
  return brands.map((b) => `"${b}"`).join(" OR ");
}

function defaultForumSubreddits() {
  // A pragmatic default list so competitor comparisons are not biased toward only
  // one brand community. Users can override with REDDIT_SUBREDDITS.
  return [
    "wyzecam",
    "ring",
    "arlo",
    "eufycam",
    "eufysecurity",
    "googlehome",
    "nest",
    "blinkcameras",
    "reolinkcam",
    "homeautomation",
    "homeassistant",
    "smarthome",
  ];
}

function envFlag(name: string, defaultValue: boolean) {
  const v = process.env[name];
  if (v === undefined) return defaultValue;
  const s = v.trim().toLowerCase();
  if (!s) return defaultValue;
  return !["0", "false", "no", "off"].includes(s);
}

function normalize(input: string) {
  return (input || "").trim().toLowerCase();
}

function inferBrandFromSubreddit(subreddit: string) {
  const s = normalize(subreddit);
  if (!s) return null;

  // Subreddit names often omit spaces/punctuation, so use substring heuristics.
  // This is intentionally conservative and mainly helps when posts do NOT mention
  // the brand name because they're already in that brand's subreddit.
  if (s.includes("wyze")) return "Wyze";
  if (s.includes("ring")) return "Ring";
  if (s.includes("arlo")) return "Arlo";
  if (s.includes("eufy")) return "Eufy";
  if (s.includes("reolink")) return "Reolink";
  if (s.includes("blink")) return "Blink";
  if (s.includes("nest") || s.includes("googlehome") || s.includes("googlenest"))
    return "Google Nest";

  return null;
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

function postToMention(p: RedditPost, ctx: { start: Date; end: Date }, hintBrand?: string) {
  const publishedAt = new Date(p.created_utc * 1000);
  if (publishedAt < ctx.start || publishedAt >= ctx.end) return null;

  const text = `${p.title}\n\n${p.selftext ?? ""}`.trim();
  if (!text) return null;

  return {
    id: `reddit:${p.name || p.id}`,
    source: "reddit",
    publishedAt: publishedAt.toISOString(),
    url: `https://www.reddit.com${p.permalink}`,
    author: p.author,
    text: text.slice(0, 1600),
    matchedBrand: hintBrand ?? "unknown",
    matchedCompetitors: [],
    rawMeta: {
      subreddit: p.subreddit,
      score: p.score,
      comments: p.num_comments,
      redditUrl: p.url,
    },
  } satisfies Mention;
}

export const redditConnector: Connector = {
  name: "reddit",
  async getMentions(ctx) {
    const token = await getRedditAccessToken();
    if (!token) return [];

    const query = process.env.REDDIT_QUERY || defaultQuery();
    const configuredSubreddits = splitCsv(process.env.REDDIT_SUBREDDITS);
    const subredditParam = configuredSubreddits.length
      ? `&sr_name=${encodeURIComponent(configuredSubreddits.join(","))}`
      : "";
    const forumSubreddits = configuredSubreddits.length
      ? configuredSubreddits
      : defaultForumSubreddits();
    const scanForums = envFlag("REDDIT_SCAN_FORUMS", true);

    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      "User-Agent": "wyze-pulse/0.1 (by u/wyze-pulse-bot)",
    } as const;

    const mentions: Mention[] = [];

    // 1) Search (query-based): captures brand mentions across Reddit. If sr_name is
    // configured, it restricts results to those subreddits.
    {
      const url =
        "https://oauth.reddit.com/search" +
        `?q=${encodeURIComponent(query)}` +
        "&sort=new&t=day&limit=75&include_over_18=off" +
        subredditParam;

      const res = await fetch(url, { headers });
      if (res.ok) {
        const json = (await res.json()) as RedditSearchResponse;
        for (const child of json.data.children ?? []) {
          const m = postToMention(child.data as RedditPost, ctx);
          if (m) mentions.push(m);
        }
      }
    }

    // 2) Optional forum scan (subreddit-based): if REDDIT_SUBREDDITS is set, also
    // pull the newest posts from those subreddits. This helps avoid bias where
    // brand forums omit the brand name in titles/selftext (e.g., posts in r/ring
    // that never say "Ring").
    if (scanForums && forumSubreddits.length) {
      const perSub = await mapWithConcurrency(forumSubreddits, 4, async (sr) => {
        const url = `https://oauth.reddit.com/r/${encodeURIComponent(sr)}/new?limit=50`;
        const res = await fetch(url, { headers });
        if (!res.ok) return [] as Mention[];

        const hintBrand = inferBrandFromSubreddit(sr);
        const json = (await res.json()) as RedditListingResponse;
        const out: Mention[] = [];
        for (const child of json.data.children ?? []) {
          const m = postToMention(child.data, ctx, hintBrand ?? undefined);
          if (m) out.push(m);
        }
        return out;
      });
      for (const arr of perSub) mentions.push(...arr);
    }

    return mentions;
  },
};
