export type BrandConfig = {
  primary: string;
  competitors: string[];
};

export const brandConfig: BrandConfig = {
  primary: "Wyze",
  competitors: ["Ring", "Arlo", "Eufy", "Google Nest", "Blink", "Reolink"],
};

export function allBrands(cfg: BrandConfig = brandConfig) {
  return [cfg.primary, ...cfg.competitors];
}

export function normalizeBrandName(input: string) {
  return input.trim().toLowerCase();
}

