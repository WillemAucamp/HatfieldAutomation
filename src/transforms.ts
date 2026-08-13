export interface MobileTransformResult {
  value: string;
  valid: boolean;
  needsManualReview: boolean;
  reason?: string;
}

/**
 * Google Sheets may strip a leading 0 from numeric mobile numbers.
 * Ensure the final value is 10 digits starting with 0.
 */
export function transformMobile(raw: string | number | undefined | null): MobileTransformResult {
  const digits = String(raw ?? "").replace(/\D/g, "");

  if (digits.length === 0) {
    return {
      value: "",
      valid: false,
      needsManualReview: true,
      reason: "Mobile number is empty",
    };
  }

  let normalized = digits;
  if (normalized.length === 9 && !normalized.startsWith("0")) {
    normalized = `0${normalized}`;
  }

  if (normalized.length !== 10 || !normalized.startsWith("0")) {
    return {
      value: normalized,
      valid: false,
      needsManualReview: true,
      reason: `Mobile number must be 10 digits starting with 0, got "${normalized}" (${normalized.length} digits)`,
    };
  }

  return { value: normalized, valid: true, needsManualReview: false };
}

/** Expected shape: MM DD YYYY (month, space, day, space, year) */
const DATE_PATTERN = /^\d{2}\s+\d{2}\s+\d{4}$/;

export interface DateTransformResult {
  value: string;
  valid: boolean;
  needsManualReview: boolean;
  reason?: string;
}

export function validateDateFormat(
  raw: string | undefined | null,
  fieldLabel: string
): DateTransformResult {
  const value = String(raw ?? "").trim();

  if (!value) {
    return {
      value: "",
      valid: false,
      needsManualReview: true,
      reason: `${fieldLabel} is empty`,
    };
  }

  if (!DATE_PATTERN.test(value)) {
    return {
      value,
      valid: false,
      needsManualReview: true,
      reason: `${fieldLabel} must match "MM DD YYYY" format, got "${value}"`,
    };
  }

  return { value, valid: true, needsManualReview: false };
}

export interface SplitNameResult {
  firstName: string;
  surname: string;
  valid: boolean;
  reason?: string;
}

/** Split a combined "First Last" (or "First Middle Last") cell on the last space. */
export function splitFullName(raw: string | undefined | null): SplitNameResult {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) {
    return { firstName: "", surname: "", valid: false, reason: "Name is empty" };
  }

  const lastSpace = value.lastIndexOf(" ");
  if (lastSpace <= 0) {
    return {
      firstName: value,
      surname: "",
      valid: false,
      reason: `Could not split first name and surname from "${value}"`,
    };
  }

  return {
    firstName: value.slice(0, lastSpace).trim(),
    surname: value.slice(lastSpace + 1).trim(),
    valid: true,
  };
}

export function normalizeCompareValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function valuesMatch(expected: string, actual: string): boolean {
  const a = normalizeCompareValue(expected);
  const b = normalizeCompareValue(actual);
  if (a === b) return true;
  // Allow numeric comparisons without spaces (e.g. "300 000" vs "300000")
  const aDigits = a.replace(/\s/g, "");
  const bDigits = b.replace(/\s/g, "");
  if (/^\d+$/.test(aDigits) && aDigits === bDigits) return true;
  return false;
}
