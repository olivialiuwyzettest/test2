import { existsSync, lstatSync, symlinkSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function ensurePrismaSymlink() {
  const packageJsonPath = require.resolve("@prisma/client/package.json");
  const clientDir = path.dirname(packageJsonPath);
  const localPrismaDir = path.join(clientDir, ".prisma");
  const siblingPrismaDir = path.join(clientDir, "..", ".prisma");

  if (!existsSync(siblingPrismaDir)) {
    return;
  }

  if (existsSync(localPrismaDir)) {
    const stat = lstatSync(localPrismaDir);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      return;
    }
  }

  symlinkSync("../.prisma", localPrismaDir, "dir");
}

try {
  ensurePrismaSymlink();
} catch (error) {
  console.error("Failed to ensure Prisma symlink", error);
  process.exit(1);
}
