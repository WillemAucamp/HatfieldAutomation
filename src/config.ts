import { config as dotenvConfig } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig, ColumnMapping } from "./types.js";

dotenvConfig();

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

function parseRowFilter(value: string | undefined): number[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

function cliFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function loadConfig(): AppConfig {
  const dryRun = cliFlag("dry-run") || parseBool(process.env.DRY_RUN, false);
  const strictMode =
    cliFlag("strict") ||
    (!cliFlag("no-strict") && parseBool(process.env.STRICT_MODE, true));

  return {
    sheetCsvUrl: process.env.SHEET_CSV_URL ?? "",
    mappingPath: process.env.MAPPING_PATH ?? "./mapping.json",
    dryRun,
    strictMode,
    headless: parseBool(process.env.HEADLESS, false),
    rowFilter: parseRowFilter(process.env.ROW_FILTER),
    actionDelayMin: parseInt(process.env.ACTION_DELAY_MIN ?? "200", 10),
    actionDelayMax: parseInt(process.env.ACTION_DELAY_MAX ?? "800", 10),
    financeUrl: "https://vwmelrose.hatfieldgroup.co.za/finance",
  };
}

export function loadColumnMapping(mappingPath: string): ColumnMapping {
  const absolute = resolve(mappingPath);
  const raw = readFileSync(absolute, "utf-8");
  return JSON.parse(raw) as ColumnMapping;
}
