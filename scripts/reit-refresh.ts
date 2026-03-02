import { refreshAndPersistReitSnapshot } from "../lib/reit/service";

async function main() {
  const result = await refreshAndPersistReitSnapshot();

  const top = result.snapshot.recommendations[0];
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: result.mode,
        warning: result.message ?? null,
        asOf: result.snapshot.asOf,
        generatedAt: result.snapshot.generatedAt,
        topTicker: top?.ticker ?? null,
        topScore: top?.score ?? null,
        universeSize: result.snapshot.universeSize,
        scoredUniverseSize: result.snapshot.scoredUniverseSize,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
