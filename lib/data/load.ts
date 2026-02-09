import { promises as fs } from "node:fs";
import path from "node:path";
import {
  EnrichedMentionSchema,
  History30dSchema,
  LatestSchema,
  type EnrichedMention,
  type History30d,
  type Latest,
} from "../schema";

async function readJsonFile<T>(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function publicDataPath(...segments: string[]) {
  return path.join(process.cwd(), "public", "data", ...segments);
}

export async function loadLatest(): Promise<Latest> {
  const file = publicDataPath("latest.json");
  const data = await readJsonFile<unknown>(file);
  return LatestSchema.parse(data);
}

export async function loadHistory30d(): Promise<History30d> {
  const file = publicDataPath("history_30d.json");
  const data = await readJsonFile<unknown>(file);
  return History30dSchema.parse(data);
}

export async function loadMentionsLatest(): Promise<EnrichedMention[]> {
  const file = publicDataPath("mentions_latest.json");
  const data = await readJsonFile<unknown>(file);
  return EnrichedMentionSchema.array().parse(data);
}

