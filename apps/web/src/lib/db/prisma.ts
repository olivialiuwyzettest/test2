import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function ensureSqliteDbFile() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return;

  // Prisma resolves relative sqlite paths against the schema directory by default (./prisma).
  const filePart = url.slice("file:".length);
  const fsPath = filePart.startsWith("/")
    ? filePart
    : path.resolve(process.cwd(), "prisma", filePart.replace(/^\.\//, ""));

  try {
    fs.mkdirSync(path.dirname(fsPath), { recursive: true });
    if (!fs.existsSync(fsPath)) fs.closeSync(fs.openSync(fsPath, "a"));
  } catch {
    // Best-effort: if this fails, Prisma will throw a clearer error.
  }
}

ensureSqliteDbFile();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
