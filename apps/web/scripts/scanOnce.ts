import { PrismaClient } from "@prisma/client";
import { runScanNow } from "@/lib/scanner/runScan";

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await runScanNow(prisma);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
