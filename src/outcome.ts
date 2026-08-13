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

/** Only a real application number counts as already submitted — not `error …`. */
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
  if (/No (dropdown )?option matching/i.test(text)) return "DROPDOWN_OPTION_MISSING";
  if (/Field not found after all lookup strategies/i.test(text)) return "FIELD_NOT_FOUND";
  if (/Strict mode:/i.test(text)) return "STRICT_VERIFY_FAILED";

  if (/txtEmailAddress/i.test(text)) return "QUALIFYING_NEXT_FAILED";
  if (/ddlcarChoiceInd|txtVehicleMaxPriceRange/i.test(text)) return "ITEM_NEXT_FAILED";
  if (/txtClientFirstName/i.test(text)) return "PERSONAL_WAIT_FAILED";
  if (/txtemployerName|ddlIndustry/i.test(text)) return "PERSONAL_NEXT_FAILED";
  if (/txtTelephonePayment|ddlBank/i.test(text)) return "WORK_NEXT_FAILED";
  if (/finish/i.test(text) && /Timeout/i.test(text)) return "FINANCIAL_NEXT_FAILED";

  if (/Timeout/i.test(text)) return `SECTION${sectionReached}_TIMEOUT`;
  return "SUBMIT_FAILED";
}
