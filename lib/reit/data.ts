import { parse } from "csv-parse/sync";
import {
  MORTGAGE_REIT_BLOCKLIST,
  getBaseUniverse,
  mapTickerToUniverseItem,
  normalizeTicker,
} from "./config";
import type { MacroInputs, MacroSeriesPoint, PriceBar, ReitUniverseItem } from "./types";

const USER_AGENT = "reit-dashboard-bot/1.0 (research dashboard)";
const FRED_ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";
const CBOE_PUTCALL_URL =
  "https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/indexpcarchive.csv";
const SCHH_HOLDINGS_URL = "https://www.schwabassetmanagement.com/allholdings/SCHH";

type FredSeriesConfig = {
  id: string;
  key: keyof MacroInputs;
};

const FRED_SERIES: FredSeriesConfig[] = [
  { id: "VIXCLS", key: "vix" },
  { id: "VXVCLS", key: "vxv" },
  { id: "BAMLH0A0HYM2", key: "hyOas" },
  { id: "BAMLC0A0CM", key: "igOas" },
  { id: "DGS10", key: "dgs10" },
  { id: "DFII10", key: "dfii10" },
  { id: "T10Y3M", key: "t10y3m" },
  { id: "DTWEXBGS", key: "usdBroad" },
  { id: "DCOILWTICO", key: "oilWti" },
  { id: "OVXCLS", key: "ovx" },
  { id: "SOFR", key: "sofr" },
  { id: "ICSA", key: "claims" },
  { id: "SAHMREALTIME", key: "sahm" },
  { id: "RECPROUSM156N", key: "recProb" },
];

function emptyMacroInputs(): MacroInputs {
  return {
    vix: [],
    vxv: [],
    hyOas: [],
    igOas: [],
    dgs10: [],
    dfii10: [],
    t10y3m: [],
    usdBroad: [],
    oilWti: [],
    ovx: [],
    sofr: [],
    claims: [],
    sahm: [],
    recProb: [],
    putCall: [],
  };
}

function coerceNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function isDateLike(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/csv,text/plain,application/json,text/html",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
  }

  return response.text();
}

function parseFredCsv(csv: string): MacroSeriesPoint[] {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  return rows
    .map((row) => {
      const date = row["date"] ?? row["DATE"];
      const value = row["value"] ?? row["VALUE"];

      if (!date || !isDateLike(date)) return null;
      if (!value || value === ".") return null;

      const numeric = coerceNumber(value);
      if (numeric === null) return null;

      return { date, value: numeric };
    })
    .filter((point): point is MacroSeriesPoint => point !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parsePutCallCsv(csv: string): MacroSeriesPoint[] {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  if (!rows.length) return [];

  const columns = Object.keys(rows[0]!);
  const ratioColumn =
    columns.find((column) => /ratio/i.test(column)) ?? columns.find((column) => /pc/i.test(column));

  if (!ratioColumn) return [];

  const dateColumn = columns.find((column) => /date/i.test(column)) ?? "DATE";

  return rows
    .map((row) => {
      const rawDate = row[dateColumn];
      const value = coerceNumber(row[ratioColumn]);
      if (!rawDate || value === null) return null;

      let date: string | null = null;
      const cleaned = rawDate.trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        date = cleaned;
      } else {
        const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (usMatch) {
          const month = usMatch[1]!.padStart(2, "0");
          const day = usMatch[2]!.padStart(2, "0");
          date = `${usMatch[3]}-${month}-${day}`;
        } else {
          const normalizedDate = new Date(cleaned);
          if (!Number.isNaN(normalizedDate.getTime())) {
            date = normalizedDate.toISOString().slice(0, 10);
          }
        }
      }

      if (!date) return null;

      return { date, value };
    })
    .filter((point): point is MacroSeriesPoint => point !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseStooqCsv(csv: string): PriceBar[] {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  return rows
    .map((row) => {
      const date = row.Date ?? row.date;
      const open = coerceNumber(row.Open ?? row.open);
      const high = coerceNumber(row.High ?? row.high);
      const low = coerceNumber(row.Low ?? row.low);
      const close = coerceNumber(row.Close ?? row.close);
      const volume = coerceNumber(row.Volume ?? row.volume);

      if (!date || !isDateLike(date)) return null;
      if (
        open === null ||
        high === null ||
        low === null ||
        close === null ||
        volume === null ||
        close <= 0
      ) {
        return null;
      }

      return {
        date,
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter((bar): bar is PriceBar => bar !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function takeRecent<T extends { date: string }>(series: T[], lookbackDays: number): T[] {
  if (!series.length) return series;
  const cutoff = new Date(series[series.length - 1]!.date);
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return series.filter((point) => point.date >= cutoffDate);
}

async function fetchFredSeriesCsv(
  seriesId: string,
  apiKey: string,
  lookbackDays: number,
): Promise<MacroSeriesPoint[]> {
  const url = new URL(FRED_ENDPOINT);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "csv");

  const csv = await fetchText(url.toString());
  const parsed = parseFredCsv(csv);
  return takeRecent(parsed, lookbackDays + 30);
}

export async function fetchMacroInputs(lookbackDays: number): Promise<MacroInputs> {
  const fredApiKey = process.env.FRED_API_KEY;
  if (!fredApiKey) {
    throw new Error("FRED_API_KEY is required for macro refresh.");
  }

  const macro = emptyMacroInputs();

  const fredResults = await Promise.all(
    FRED_SERIES.map(async (series) => {
      const points = await fetchFredSeriesCsv(series.id, fredApiKey, lookbackDays);
      return { key: series.key, points };
    }),
  );

  for (const result of fredResults) {
    macro[result.key] = result.points;
  }

  const putCallCsv = await fetchText(CBOE_PUTCALL_URL);
  macro.putCall = takeRecent(parsePutCallCsv(putCallCsv), lookbackDays + 30);

  return macro;
}

async function scrapeSchhTickers(): Promise<string[]> {
  const html = await fetchText(SCHH_HOLDINGS_URL);

  const candidates = new Set<string>();
  const patterns = [/"ticker"\s*:\s*"([A-Z.]{1,6})"/g, /"symbol"\s*:\s*"([A-Z.]{1,6})"/g];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const ticker = normalizeTicker(match[1] ?? "");
      if (ticker) candidates.add(ticker);
    }
  }

  return [...candidates].filter((ticker) => !MORTGAGE_REIT_BLOCKLIST.has(ticker));
}

export async function loadReitUniverse(): Promise<ReitUniverseItem[]> {
  const envTickers = process.env.REIT_UNIVERSE_TICKERS
    ? process.env.REIT_UNIVERSE_TICKERS.split(",").map(normalizeTicker).filter(Boolean)
    : [];

  if (envTickers.length) {
    return envTickers
      .filter((ticker) => !MORTGAGE_REIT_BLOCKLIST.has(ticker))
      .map((ticker) => mapTickerToUniverseItem(ticker));
  }

  if (process.env.REIT_UNIVERSE_SOURCE === "schh") {
    try {
      const schhTickers = await scrapeSchhTickers();
      if (schhTickers.length >= 25) {
        return schhTickers.map((ticker) => mapTickerToUniverseItem(ticker));
      }
    } catch {
      // Fall back to curated base universe if holdings scrape fails.
    }
  }

  return getBaseUniverse();
}

export async function fetchTickerPriceHistory(ticker: string): Promise<PriceBar[]> {
  const symbol = `${normalizeTicker(ticker).toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;
  const csv = await fetchText(url);
  return parseStooqCsv(csv);
}

function parsePercentValue(raw: string): number | null {
  const cleaned = raw.replace(",", ".").replace("%", "").trim();
  if (!cleaned || cleaned === "-") return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

async function fetchTickerDividendYield(ticker: string): Promise<number | null> {
  const symbol = `${normalizeTicker(ticker).toLowerCase()}.us`;
  const url = `https://stooq.com/q/g/?s=${symbol}`;
  const html = await fetchText(url);

  const match =
    html.match(
      /(?:Stopa dywidendy|Dividend Yield).*?<\/(?:font|td)>\s*<\/td>\s*<td[^>]*>\s*([0-9.,-]+)\s*%/is,
    ) ??
    html.match(/(?:Stopa dywidendy|Dividend Yield)[^0-9-]{0,180}([0-9.,-]+)\s*%/i);

  if (!match || !match[1]) return null;
  return parsePercentValue(match[1]);
}

export async function fetchDividendYields(tickers: string[]): Promise<Map<string, number | null>> {
  const unique = [...new Set(tickers.map(normalizeTicker).filter(Boolean))];

  const entries = await mapWithConcurrency(unique, 4, async (ticker) => {
    try {
      const dividendYield = await fetchTickerDividendYield(ticker);
      return [ticker, dividendYield] as const;
    } catch {
      return [ticker, null] as const;
    }
  });

  return new Map(entries);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let pointer = 0;

  async function run() {
    while (pointer < items.length) {
      const current = pointer;
      pointer += 1;
      results[current] = await worker(items[current]!, current);
    }
  }

  const runners = Array.from({ length: Math.min(items.length, Math.max(concurrency, 1)) }, () => run());
  await Promise.all(runners);
  return results;
}
