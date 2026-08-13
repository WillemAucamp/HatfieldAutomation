export interface TransformResult {
  value: string;
  valid: boolean;
  code?: string;
  message?: string;
}

function digitsOnly(raw: string | number | undefined | null): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * Google Sheets may strip a leading 0 from numeric phone cells.
 * Only that known artefact is corrected: 9 digits → prepend 0.
 * Anything else that is not a 10-digit number starting with 0 is human error.
 */
export function transformMobile(raw: string | number | undefined | null): TransformResult {
  const original = String(raw ?? "").trim();
  let digits = digitsOnly(raw);

  if (digits.length === 0) {
    return {
      value: original,
      valid: false,
      code: "MOBILE_EMPTY",
      message: "Mobile number is empty",
    };
  }

  if (digits.length === 11 && digits.startsWith("27")) {
    digits = `0${digits.slice(2)}`;
  }

  if (digits.length === 9 && !digits.startsWith("0")) {
    digits = `0${digits}`;
  }

  if (digits.length !== 10 || !digits.startsWith("0")) {
    return {
      value: original,
      valid: false,
      code: "MOBILE_NOT_10_DIGITS",
      message: `Mobile number must be 10 digits starting with 0, got "${original}" (${digitsOnly(raw).length} digits)`,
    };
  }

  return { value: digits, valid: true };
}

/**
 * RSA ID numbers must be exactly 13 digits. Short/long/empty values are treated
 * as human error — the website will reject them, so we do not invent digits.
 */
export function validateIdNumber(raw: string | number | undefined | null): TransformResult {
  const original = String(raw ?? "").trim();
  let source = original;
  if (/e\+/i.test(source)) {
    const n = Number(source);
    if (Number.isFinite(n)) source = n.toFixed(0);
  }

  const digits = digitsOnly(source);

  if (digits.length === 0) {
    return {
      value: original,
      valid: false,
      code: "ID_EMPTY",
      message: "ID number is empty",
    };
  }

  if (digits.length !== 13) {
    return {
      value: original,
      valid: false,
      code: "ID_NOT_13_DIGITS",
      message: `ID number is not 13 digits (got ${digits.length}: "${original}")`,
    };
  }

  return { value: digits, valid: true };
}

const DATE_PATTERN = /^\d{2}\s+\d{2}\s+\d{4}$/;

export function validateDateFormat(
  raw: string | undefined | null,
  fieldLabel: string,
  emptyCode: string,
  formatCode: string
): TransformResult {
  const value = String(raw ?? "").trim();

  if (!value) {
    return {
      value: "",
      valid: false,
      code: emptyCode,
      message: `${fieldLabel} is empty`,
    };
  }

  if (!DATE_PATTERN.test(value)) {
    return {
      value,
      valid: false,
      code: formatCode,
      message: `${fieldLabel} must be MM DD YYYY (got "${value}")`,
    };
  }

  return { value, valid: true };
}

export interface SplitNameResult {
  firstName: string;
  surname: string;
  valid: boolean;
  code?: string;
  message?: string;
}

/** Split a combined "First Last" cell on the last space. Incomplete names are errors. */
export function splitFullName(
  raw: string | undefined | null,
  emptyCode: string,
  surnameCode: string,
  label: string
): SplitNameResult {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) {
    return {
      firstName: "",
      surname: "",
      valid: false,
      code: emptyCode,
      message: `${label} is empty`,
    };
  }

  const lastSpace = value.lastIndexOf(" ");
  if (lastSpace <= 0) {
    return {
      firstName: value,
      surname: "",
      valid: false,
      code: surnameCode,
      message: `${label} "${value}" has no surname (expected "First Last")`,
    };
  }

  return {
    firstName: value.slice(0, lastSpace).trim(),
    surname: value.slice(lastSpace + 1).trim(),
    valid: true,
  };
}

export function requireText(
  raw: string | undefined | null,
  code: string,
  message: string
): TransformResult {
  const value = String(raw ?? "").trim();
  if (!value) {
    return { value: "", valid: false, code, message };
  }
  return { value, valid: true };
}

export function requireEmail(raw: string | undefined | null): TransformResult {
  const value = String(raw ?? "").trim();
  if (!value) {
    return { value: "", valid: false, code: "EMAIL_EMPTY", message: "Email is empty" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return {
      value,
      valid: false,
      code: "EMAIL_INVALID",
      message: `Email is not a valid address (got "${value}")`,
    };
  }
  return { value, valid: true };
}

export function requireAmount(
  raw: string | undefined | null,
  code: string,
  label: string
): TransformResult {
  const value = String(raw ?? "").trim();
  if (!value) {
    return { value: "", valid: false, code, message: `${label} is empty` };
  }
  return { value, valid: true };
}

export function normalizeCompareValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function valuesMatch(expected: string, actual: string): boolean {
  const a = normalizeCompareValue(expected);
  const b = normalizeCompareValue(actual);
  if (a === b) return true;
  if (a.length >= 3 && b.includes(a)) return true;
  if (b.length >= 3 && a.includes(b)) return true;
  const aNum = parseFloat(a.replace(/[r$€,\s]/gi, "").replace(/[^\d.]/g, ""));
  const bNum = parseFloat(b.replace(/[r$€,\s]/gi, "").replace(/[^\d.]/g, ""));
  if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum === bNum) return true;
  return false;
}
