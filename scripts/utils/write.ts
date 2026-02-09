import { promises as fs } from "node:fs";
import path from "node:path";

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJsonIfChanged(
  filePath: string,
  data: unknown,
): Promise<{ changed: boolean }> {
  const next = JSON.stringify(data, null, 2) + "\n";
  let prev: string | null = null;
  try {
    prev = await fs.readFile(filePath, "utf8");
  } catch {
    prev = null;
  }

  if (prev === next) return { changed: false };

  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, next, "utf8");
  return { changed: true };
}

