import { parse } from "csv-parse/sync";

export function parseCsvRows(input: string): Record<string, string>[] {
  const rows = parse(input, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return rows.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.trim().toLowerCase()] = (value ?? "").trim();
    }
    return normalized;
  });
}
