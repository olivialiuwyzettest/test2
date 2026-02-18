import "server-only";
import { PrismaClient } from "@prisma/client";

declare global {
  var __wyzeRtoPrisma: PrismaClient | undefined;
}

export const db =
  global.__wyzeRtoPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__wyzeRtoPrisma = db;
}
