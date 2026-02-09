/* eslint-disable no-console */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function isFileSqliteUrl(url) {
  return typeof url === "string" && url.startsWith("file:");
}

function ensureSqliteDbFile() {
  const url = process.env.DATABASE_URL;
  if (!isFileSqliteUrl(url)) return;

  const filePart = url.slice("file:".length);
  if (!filePart.startsWith("/")) return; // In Render we use an absolute path on a mounted disk.

  fs.mkdirSync(path.dirname(filePart), { recursive: true });
  if (!fs.existsSync(filePart)) fs.closeSync(fs.openSync(filePart, "a"));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function spawnLongRunning(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  return child;
}

async function main() {
  const port = process.env.PORT || "3000";

  console.log("[render] Ensuring SQLite DB file exists...");
  try {
    ensureSqliteDbFile();
  } catch (e) {
    console.error("[render] Failed to prepare sqlite file:", e);
    // Continue; prisma will fail later with a clearer error if this is fatal.
  }

  console.log("[render] Running prisma migrations...");
  await run("./node_modules/.bin/prisma", ["migrate", "deploy"], { env: process.env });

  console.log("[render] Seeding (safe to re-run)...");
  try {
    await run("./node_modules/.bin/prisma", ["db", "seed"], { env: process.env });
  } catch (e) {
    console.warn("[render] Seed failed (continuing):", e?.message || String(e));
  }

  console.log("[render] Starting worker (daily scanner)...");
  const worker = spawnLongRunning("./node_modules/.bin/tsx", ["scripts/worker.ts"], { env: process.env });

  console.log(`[render] Starting Next.js server on 0.0.0.0:${port}...`);
  const web = spawnLongRunning("./node_modules/.bin/next", ["start", "-H", "0.0.0.0", "-p", port], {
    env: process.env,
  });

  const shutdown = (signal) => {
    console.log(`[render] Shutting down (${signal})...`);
    try {
      web.kill("SIGTERM");
    } catch {}
    try {
      worker.kill("SIGTERM");
    } catch {}
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // If either process exits, terminate the other and exit.
  await new Promise((resolve, reject) => {
    const onExit = (name, code, signal) => {
      console.log(`[render] ${name} exited`, { code, signal });
      shutdown(`${name}-exit`);
      if (code && code !== 0) reject(new Error(`${name} exited with code ${code}`));
      else resolve();
    };

    worker.on("exit", (code, signal) => onExit("worker", code, signal));
    web.on("exit", (code, signal) => onExit("web", code, signal));
  });
}

main().catch((err) => {
  console.error("[render] Fatal startup error:", err);
  process.exit(1);
});

