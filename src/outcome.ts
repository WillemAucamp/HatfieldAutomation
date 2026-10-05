import { parseReferenceNumber } from "./reference.js";

/** Sheet cell written on failure, e.g. `error ID_NOT_13_DIGITS`. */
export function formatErrorCell(codes: string[]): string {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  const joined = unique.length > 0 ? unique.join(", ") : "SUBMIT_FAILED";
  return `error ${joined}`;
}

export function isErrorCell(value: string | undefined | null): boolean {
  return /^error\b/i.test(String(value ?? "").trim());
}

/** Any non-empty Status cell means the row was already attempted. */
export function isStatusPopulated(value: string | undefined | null): boolean {
  return String(value ?? "").trim().length > 0;
}

/** Only a real application number — used to avoid a duplicate submit from local logs. */
export function successfulReferenceFromCell(value: string | undefined | null): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || isErrorCell(trimmed)) return undefined;
  return parseReferenceNumber(trimmed) ?? undefined;
}

export function durationSeconds(startedMs: number, endedMs = Date.now()): number {
  return Math.max(0, Math.round((endedMs - startedMs) / 100) / 10);
}

/**
 * Map a runtime exception to a short code we can write to the sheet
 * and iterate on. Data-validation codes (ID_NOT_13_DIGITS, …) are passed through as-is.
 */
export function classifyRuntimeError(error: string, sectionReached: number): string {
  const text = error.replace(/\s+/g, " ");

  if (/iframe did not load/i.test(text)) return "FORM_IFRAME_TIMEOUT";
  if (/apply for finance/i.test(text)) return "APPLY_CLICK_FAILED";
  if (/Finish was clicked but no application reference/i.test(text)) return "FINISH_NO_REFERENCE";
  if (/angucomplete-row/i.test(text)) return "POSTAL_AUTOCOMPLETE_FAILED";
  if (/No postal autocomplete match/i.test(text)) return "POSTAL_AUTOCOMPLETE_FAILED";
  if (/No (dropdown )?option matching/i.test(text)) return "DROPDOWN_OPTION_MISSING";
  if (/Field not found after all lookup strategies/i.test(text)) return "FIELD_NOT_FOUND";
  if (/Strict mode:/i.test(text)) return "STRICT_VERIFY_FAILED";

  if (/Work & Salary Next did not open/i.test(text)) return "WORK_NEXT_FAILED";
  if (/Personal Information Next did not open/i.test(text)) return "PERSONAL_NEXT_FAILED";
  if (/txtEmailAddress/i.test(text)) return "QUALIFYING_NEXT_FAILED";
  if (/ddlcarChoiceInd|txtVehicleMaxPriceRange/i.test(text)) return "ITEM_NEXT_FAILED";
  if (/txtClientFirstName/i.test(text)) return "PERSONAL_WAIT_FAILED";
  if (/txtemployerName|ddlIndustry/i.test(text)) return "PERSONAL_NEXT_FAILED";
  if (/txtTelephonePayment|ddlBank/i.test(text)) return "WORK_NEXT_FAILED";
  if (/finish/i.test(text) && /Timeout/i.test(text)) return "FINANCIAL_NEXT_FAILED";

  if (/Timeout/i.test(text)) return `SECTION${sectionReached}_TIMEOUT`;
  return "SUBMIT_FAILED";
}

const STATUS_MAX = 220;

export function clipStatus(text: string, max = STATUS_MAX): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

function isSheetDropdown(field: string): boolean {
  return /^(bank|account type|province|work province)$/i.test(field.trim());
}

export function humanHintForError(error: string, code: string): string {
  const text = error.replace(/\s+/g, " ").trim();
  const dropdown = text.match(
    /No option matching "([^"]+)" in ([^.]+)\.(?: Available: (.*?)(?:\.|$))?/i
  );
  if (dropdown) {
    const value = dropdown[1];
    const field = dropdown[2].trim();
    const available = (dropdown[3] ?? "")
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 5);
    const options = available.length ? ` Use: ${available.join(", ")}.` : "";
    if (isSheetDropdown(field)) {
      return `${field} "${value}" is not a Seriti option.${options} Change that sheet column, clear Status, run load-only.`;
    }
    return `${field} menu had no "${value}".${
      available.length ? ` Seriti has: ${available.join(", ")}.` : " Dropdown was empty."
    } Not a sheet cell. Clear Status, run load-only.`;
  }

  const formSaid = text.match(/Form said: ([^.]+)/i);
  if (code === "WORK_NEXT_FAILED") {
    return (
      "Work & Salary Next did not open expenses. Not telephone/bank." +
      (formSaid
        ? ` Form said: ${formSaid[1].trim()}.`
        : " Check employment date, salary (nett ≤ gross), Industry/Occupation.") +
      " Clear Status, run load-only."
    );
  }
  if (code === "PERSONAL_NEXT_FAILED") {
    return (
      "Personal Next did not open Work." +
      (formSaid
        ? ` Form said: ${formSaid[1].trim()}.`
        : " Check residency date, postal code, ID, province.") +
      " Clear Status, run load-only."
    );
  }
  if (code === "POSTAL_AUTOCOMPLETE_FAILED") {
    return "Postal code did not match Seriti’s suburb list. Fix Postal code/address, clear Status, run load-only.";
  }
  return text.slice(0, 160);
}

/** Operator-readable Status for a Seriti runtime failure. */
export function formatRuntimeErrorCell(error: string, sectionReached: number): string {
  const code = classifyRuntimeError(error, sectionReached);
  return clipStatus(`error ${code}: ${humanHintForError(error, code)}`);
}
