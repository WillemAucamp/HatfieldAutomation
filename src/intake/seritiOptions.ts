import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSelectText, pickSelectOption } from "../selectMatch.js";
import { isMissingValue, transformMobile } from "../transforms.js";

export interface SeritiOptions {
  industries: string[];
  levels: string[];
  occupations: string[];
  industry_aliases: Record<string, string>;
  level_aliases: Record<string, string>;
  occupation_aliases?: Record<string, string>;
  occupation_fallback: string;
  level_fallback?: string;
  self_employed_industry: string;
  self_employed_occupation?: string;
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
    if (
      key === alias ||
      key.startsWith(`${alias} `) ||
      key.includes(` ${alias} `) ||
      key.endsWith(` ${alias}`)
    ) {
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

/**
 * Map free-text level onto exact Seriti Level strings.
 * Unmatched / empty → level_fallback (SKILLED WORKER) so Seriti never sees "skilled"
 * or "operational".
 */
export function mapLevel(raw: string, options: SeritiOptions = loadSeritiOptions()): string {
  const fallback = options.level_fallback || "SKILLED WORKER";
  const value = String(raw ?? "").trim();
  if (!value) return fallback;
  const aliased = aliasLookup(options.level_aliases, value);
  if (aliased) return aliased;
  return matchFromList(value, options.levels) || fallback;
}

export function mapOccupation(
  raw: string,
  options: SeritiOptions = loadSeritiOptions()
): string {
  const value = String(raw ?? "").trim();
  if (!value) return options.occupation_fallback;
  if (isSelfEmployed(value)) return selfEmployedOccupation(options);
  const aliases = options.occupation_aliases ?? {};
  const aliased = aliasLookup(aliases, value);
  if (aliased) return aliased;
  // Exact Seriti string "LABOURER (SKILLED)" is the old automation default written
  // onto the sheet. Remap it to the current fallback. Real job titles like
  // "Labourer" / "Skilled labourer" still match the Seriti list below.
  if (normalizeSelectText(value) === "labourer skilled") {
    return options.occupation_fallback;
  }
  const matched = matchFromList(value, options.occupations);
  // Only keep a LABOURER menu pick when the job title actually says labourer.
  // Vague titles must not fuzzy-match onto the old default.
  if (matched && /^LABOURER\b/i.test(matched) && !/\blabou?rers?\b/i.test(value)) {
    return options.occupation_fallback;
  }
  return matched || options.occupation_fallback;
}

export function isSelfEmployed(employmentRaw: string, jobTitle = "", employerName = ""): boolean {
  const blob = `${employmentRaw} ${jobTitle} ${employerName}`.toLowerCase();
  return /\bself[-\s]?employ/.test(blob) || /\bown(?:er|ed)?\s+business\b/.test(blob);
}

/** Form Employment and/or automation-sheet Industry / Occupation / Employer text. */
export function clientSelfEmployed(input: {
  employment?: string;
  jobTitle?: string;
  employerName?: string;
  sheetOccupation?: string;
  sheetIndustry?: string;
  sheetEmployerName?: string;
}): boolean {
  if (isSelfEmployed(input.employment ?? "", input.jobTitle ?? "", input.employerName ?? "")) {
    return true;
  }
  return isSelfEmployed(
    input.sheetOccupation ?? "",
    input.sheetIndustry ?? "",
    input.sheetEmployerName ?? ""
  );
}

/** Seriti Occupation shown when the client said they are self-employed. */
export function selfEmployedOccupation(options: SeritiOptions = loadSeritiOptions()): string {
  return options.self_employed_occupation?.trim() || "SELF EMPLOYED (NON PROFESSIONAL)";
}

/**
 * Copy residential address onto the employer address block.
 * Caller must pass selfEmployed=true. Employed clients keep the employer cells unchanged.
 */
export function copyResidentialOntoEmployer(input: {
  selfEmployed: boolean;
  /** When true (self-employed policy), employer fields always mirror residential. */
  overwrite?: boolean;
  residentialAddress: string;
  residentialPostal: string;
  residentialProvince: string;
  employerAddress: string;
  employerPostal: string;
  employerProvince: string;
}): { employerAddress: string; employerPostal: string; employerProvince: string } {
  if (!input.selfEmployed) {
    return {
      employerAddress: input.employerAddress,
      employerPostal: input.employerPostal,
      employerProvince: input.employerProvince,
    };
  }
  const overwrite = Boolean(input.overwrite);
  const fill = (current: string, residential: string) => {
    const home = String(residential ?? "").trim();
    if (overwrite) return home;
    return isMissingValue(current) ? home : String(current ?? "").trim();
  };
  return {
    employerAddress: fill(input.employerAddress, input.residentialAddress),
    employerPostal: fill(input.employerPostal, input.residentialPostal),
    employerProvince: fill(input.employerProvince, input.residentialProvince),
  };
}

/** Self-employed Seriti work block mirrors personal contact/address (only allowed duplicate). */
export function mirrorSelfEmployedEmployerFromPersonal(input: {
  fullName: string;
  mobile: string;
  residentialAddress: string;
  residentialPostal: string;
  residentialProvince: string;
  employerName: string;
  employerPhone: string;
  employerAddress: string;
  employerPostal: string;
  employerProvince: string;
}): {
  employerName: string;
  employerPhone: string;
  employerAddress: string;
  employerPostal: string;
  employerProvince: string;
} {
  const copied = copyResidentialOntoEmployer({
    selfEmployed: true,
    overwrite: true,
    residentialAddress: input.residentialAddress,
    residentialPostal: input.residentialPostal,
    residentialProvince: input.residentialProvince,
    employerAddress: input.employerAddress,
    employerPostal: input.employerPostal,
    employerProvince: input.employerProvince,
  });
  const mobile = transformMobile(input.mobile);
  const employerPhone = mobile.valid ? mobile.value : String(input.mobile ?? "").trim();
  const employerName =
    String(input.employerName ?? "").trim() || String(input.fullName ?? "").trim();
  return {
    employerName,
    employerPhone,
    employerAddress: copied.employerAddress,
    employerPostal: copied.employerPostal,
    employerProvince: copied.employerProvince,
  };
}

export function formatSeritiListsForPrompt(options: SeritiOptions = loadSeritiOptions()): string {
  const numbered = (items: string[]) =>
    items.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return `INDUSTRY (pick exactly one string, or ""):
${numbered(options.industries)}

EMPLOYEE LEVEL (pick exactly one string, or ""):
${numbered(options.levels)}

OCCUPATION is mapped in code from the job title — do not invent an Occupation value.
If nothing in the job title matches the Seriti Occupation list, use ${options.occupation_fallback}.
If the client is self-employed, Industry MUST be ${options.self_employed_industry} and Occupation MUST be ${options.self_employed_occupation || "SELF EMPLOYED (NON PROFESSIONAL)"}.`;
}
