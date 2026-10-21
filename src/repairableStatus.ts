import { formatDataErrorCell } from "./outcome.js";
import { isMissingValue, validateDateFormat, validateIdNumber } from "./transforms.js";

/** Form-field gaps a later ingest/repair can copy onto the automation sheet. */
export const REPAIRABLE_ERROR_CODES = [
  "MARITAL_DATE_EMPTY",
  "MARITAL_DATE_FORMAT",
  "SPOUSE_ID_EMPTY",
  "SPOUSE_NAME_EMPTY",
] as const;

const REPAIRABLE = new Set<string>(REPAIRABLE_ERROR_CODES);

/** Codes written into a sheet Status cell (`error CODE` / `error CODE: message`). */
export function errorCodesFromStatus(status: string | undefined | null): string[] {
  const s = String(status ?? "").trim();
  if (!/^error\b/i.test(s)) return [];
  const body = s.replace(/^error\s+/i, "");
  const codes: string[] = [];
  // Require a SNAKE_CASE token so message words like "copy" / "YYYY" are ignored.
  for (const match of body.toUpperCase().matchAll(/\b([A-Z]+(?:_[A-Z0-9]+)+)\b/g)) {
    codes.push(match[1]!);
  }
  return [...new Set(codes)];
}

/**
 * Blank Status (normal repair) plus recoverable Form-copy errors.
 * Loaded refs and unrecoverable client errors stay untouched.
 */
export function isRepairableAutomationStatus(status: string | undefined | null): boolean {
  const s = String(status ?? "").trim();
  if (!s) return true;
  const codes = errorCodesFromStatus(s);
  if (codes.length === 0) return false;
  return codes.every((code) => REPAIRABLE.has(code));
}

/** After a Form rebuild filled the missing Seriti fields, Status can be cleared for load. */
export function shouldClearRepairedStatus(
  previousStatus: string | undefined | null,
  next: Record<string, string>
): boolean {
  const s = String(previousStatus ?? "").trim();
  if (!s || !isRepairableAutomationStatus(s)) return false;
  const codes = errorCodesFromStatus(s);
  if (codes.length === 0) return false;
  for (const code of codes) {
    if (code === "MARITAL_DATE_EMPTY" || code === "MARITAL_DATE_FORMAT") {
      if (!validateDateFormat(next["Marital date"] || "", "Marital date", "EMPTY", "FORMAT").valid) {
        return false;
      }
    }
    if (code === "SPOUSE_ID_EMPTY") {
      if (!validateIdNumber(next["Spouse ID number"] || "").valid) return false;
    }
    if (code === "SPOUSE_NAME_EMPTY") {
      if (isMissingValue(next["Spouse Name + Surname"] || "")) return false;
    }
  }
  return true;
}

/** Example Status cell the loader writes when Married is missing Marital date. */
export function maritalDateEmptyStatusExample(): string {
  return formatDataErrorCell([
    {
      code: "MARITAL_DATE_EMPTY",
      message:
        "Not Single requires Marital Date on Seriti; copy Marital date from the Form (DD/MM/YYYY)",
    },
  ]);
}
