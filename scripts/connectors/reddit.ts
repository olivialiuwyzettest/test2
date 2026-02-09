import type { Mention } from "../../lib/schema";
import type { Connector } from "./types";
import { allBrands, brandConfig } from "../../config/brands";

type RedditTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
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

export const redditConnector: Connector = {
  name: "reddit",
  async getMentions(ctx) {
    const token = await getRedditAccessToken();
    if (!token) return [];

    const query = process.env.REDDIT_QUERY || defaultQuery();
    const subreddits = splitCsv(process.env.REDDIT_SUBREDDITS);
    const subredditParam = subreddits.length ? `&sr_name=${encodeURIComponent(subreddits.join(","))}` : "";

    const url =
      "https://oauth.reddit.com/search" +
      `?q=${encodeURIComponent(query)}` +
      "&sort=new&t=day&limit=75&include_over_18=off" +
      subredditParam;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "wyze-pulse/0.1 (by u/wyze-pulse-bot)",
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as RedditSearchResponse;

    const mentions: Mention[] = [];
    for (const child of json.data.children ?? []) {
      const p = child.data;
      const publishedAt = new Date(p.created_utc * 1000);
      if (publishedAt < ctx.start || publishedAt >= ctx.end) continue;

      const text = `${p.title}\n\n${p.selftext ?? ""}`.trim();
      if (!text) continue;

      mentions.push({
        id: `reddit:${p.name || p.id}`,
        source: "reddit",
        publishedAt: publishedAt.toISOString(),
        url: `https://www.reddit.com${p.permalink}`,
        author: p.author,
        text: text.slice(0, 1600),
        matchedBrand: "unknown",
        matchedCompetitors: [],
        rawMeta: {
          subreddit: p.subreddit,
          score: p.score,
          comments: p.num_comments,
          redditUrl: p.url,
        },
      });
    }

    return mentions;
  },
};

