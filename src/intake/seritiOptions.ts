import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSelectText, pickSelectOption } from "../selectMatch.js";

export interface SeritiOptions {
  industries: string[];
  levels: string[];
  occupations: string[];
  industry_aliases: Record<string, string>;
  level_aliases: Record<string, string>;
  occupation_fallback: string;
  self_employed_industry: string;
}

let cached: SeritiOptions | null = null;

export function loadSeritiOptions(path = "./config/seriti-options.json"): SeritiOptions {
  if (cached) return cached;
  const absolute = resolve(path);
  cached = JSON.parse(readFileSync(absolute, "utf-8")) as SeritiOptions;
  return cached;
}

/** Test helper — clear memoized options after path overrides. */
export function clearSeritiOptionsCache(): void {
  cached = null;
}

function aliasLookup(aliases: Record<string, string>, raw: string): string {
  const key = normalizeSelectText(raw);
  if (!key) return "";
  if (aliases[key]) return aliases[key];
  // Prefer longer alias keys so "senior management" wins over "senior".
  const entries = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, value] of entries) {
    if (key === alias || key.startsWith(`${alias} `) || key.includes(` ${alias} `) || key.endsWith(` ${alias}`)) {
      return value;
    }
  }
  return "";
}

function matchFromList(raw: string, options: string[]): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const picked = pickSelectOption(
    options.map((text, i) => ({ value: String(i), text })),
    value
  );
  return picked?.text ?? "";
}

export function mapIndustry(raw: string, options: SeritiOptions = loadSeritiOptions()): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const aliased = aliasLookup(options.industry_aliases, value);
  if (aliased) return aliased;
  return matchFromList(value, options.industries);
}

export function mapLevel(raw: string, options: SeritiOptions = loadSeritiOptions()): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const aliased = aliasLookup(options.level_aliases, value);
  if (aliased) return aliased;
  return matchFromList(value, options.levels);
}

export function mapOccupation(
  raw: string,
  options: SeritiOptions = loadSeritiOptions()
): string {
  const value = String(raw ?? "").trim();
  if (!value) return options.occupation_fallback;
  const matched = matchFromList(value, options.occupations);
  return matched || options.occupation_fallback;
}

export function isSelfEmployed(employmentRaw: string, jobTitle = "", employerName = ""): boolean {
  const blob = `${employmentRaw} ${jobTitle} ${employerName}`.toLowerCase();
  return /\bself[-\s]?employ/.test(blob) || /\bown(?:er|ed)?\s+business\b/.test(blob);
}

export function formatSeritiListsForPrompt(options: SeritiOptions = loadSeritiOptions()): string {
  const numbered = (items: string[]) =>
    items.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return `INDUSTRY (pick exactly one string, or ""):
${numbered(options.industries)}

EMPLOYEE LEVEL (pick exactly one string, or ""):
${numbered(options.levels)}

OCCUPATION is mapped in code from the job title — do not invent an Occupation value.
If the client is self-employed, Industry MUST be ${options.self_employed_industry}.`;
}
