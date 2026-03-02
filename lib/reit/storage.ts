import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReitDashboardSnapshot, ReitHistory } from "./types";

const OUTPUT_DIR = path.join(process.cwd(), "output", "reit");
const LATEST_PATH = path.join(OUTPUT_DIR, "latest.json");
const HISTORY_PATH = path.join(OUTPUT_DIR, "history.json");

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, payload: unknown) {
  await ensureOutputDir();
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export async function readLatestSnapshot(): Promise<ReitDashboardSnapshot | null> {
  return readJson<ReitDashboardSnapshot>(LATEST_PATH);
}

export async function readHistory(): Promise<ReitHistory> {
  const existing = await readJson<ReitHistory>(HISTORY_PATH);
  if (existing) return existing;
  return {
    updatedAt: new Date(0).toISOString(),
    points: [],
  };
}

export async function persistSnapshot(snapshot: ReitDashboardSnapshot): Promise<void> {
  await writeJson(LATEST_PATH, snapshot);

  const history = await readHistory();
  const nextPoints = [
    ...history.points,
    {
      date: snapshot.asOf,
      generatedAt: snapshot.generatedAt,
      riskGate: snapshot.macro.riskGate,
      msiLevel: snapshot.macro.msiLevel,
      topTicker: snapshot.recommendations[0]?.ticker ?? null,
      topScore: snapshot.recommendations[0]?.score ?? null,
    },
  ];

  const deduped = new Map<string, (typeof nextPoints)[number]>();
  for (const point of nextPoints) {
    deduped.set(point.date, point);
  }

  const points = [...deduped.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-180);

  await writeJson(HISTORY_PATH, {
    updatedAt: new Date().toISOString(),
    points,
  } satisfies ReitHistory);
}

export const reitOutputPaths = {
  latest: LATEST_PATH,
  history: HISTORY_PATH,
};
