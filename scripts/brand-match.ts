import { allBrands, brandConfig, normalizeBrandName } from "../config/brands";

type BrandMatch = {
  matchedBrand: string;
  matchedCompetitors: string[];
};

const synonyms: Record<string, string[]> = {
  wyze: ["wyze cam", "wyze camera", "wyze sense", "wyze app"],
  ring: ["ring alarm", "ring camera", "ring doorbell"],
  arlo: ["arlo camera", "arlo secure"],
  eufy: ["eufy security", "eufycam", "eufy cam"],
  "google nest": ["nest", "nest cam", "nest doorbell", "google nest"],
  blink: ["blink camera", "blink outdoor", "blink mini"],
  reolink: ["reolink camera", "reolink cam"],
};

function buildMatchers() {
  const brands = allBrands(brandConfig);
  return brands.map((brand) => {
    const key = normalizeBrandName(brand);
    const patterns = [brand, ...(synonyms[key] ?? [])]
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    const regexes = patterns.map((p) => {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i");
    });

    return { brand, key, regexes };
  });
}

const matchers = buildMatchers();

export function matchBrandsInText(text: string): BrandMatch {
  const t = text ?? "";
  const hits: Array<{ brand: string; idx: number }> = [];

  for (const m of matchers) {
    let bestIdx: number | null = null;
    for (const re of m.regexes) {
      const match = re.exec(t);
      if (!match) continue;
      const idx = match.index ?? 0;
      if (bestIdx === null || idx < bestIdx) bestIdx = idx;
    }
    if (bestIdx !== null) hits.push({ brand: m.brand, idx: bestIdx });
  }

  hits.sort((a, b) => a.idx - b.idx);
  const brands = hits.map((h) => h.brand);

  if (brands.length === 0) {
    return { matchedBrand: "unknown", matchedCompetitors: [] };
  }

  const primary = brandConfig.primary;
  const matchedBrand = brands.includes(primary) ? primary : brands[0]!;
  const matchedCompetitors = brands.filter((b) => b !== matchedBrand);
  return { matchedBrand, matchedCompetitors };
}
