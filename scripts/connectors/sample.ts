import { promises as fs } from "node:fs";
import path from "node:path";
import { MentionSchema, type Mention } from "../../lib/schema";
import type { Connector } from "./types";

function repoPath(...segments: string[]) {
  return path.join(process.cwd(), ...segments);
}

function rebaseMentionsToRange(raw: Mention[], end: Date) {
  const max = raw
    .map((m) => new Date(m.publishedAt).getTime())
    .reduce((a, b) => Math.max(a, b), 0);
  const shiftMs = end.getTime() - max;
  return raw.map((m) => ({
    ...m,
    publishedAt: new Date(new Date(m.publishedAt).getTime() + shiftMs).toISOString(),
  }));
}

export const sampleConnector: Connector = {
  name: "sample",
  async getMentions(ctx) {
    const file = repoPath("data", "sample_mentions.json");
    const rawText = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(rawText);
    const mentions = MentionSchema.array().parse(parsed);

    const rebased = rebaseMentionsToRange(mentions, ctx.end);
    return rebased.filter((m) => {
      const ts = new Date(m.publishedAt).getTime();
      return ts >= ctx.start.getTime() && ts < ctx.end.getTime();
    });
  },
};

