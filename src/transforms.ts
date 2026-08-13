export interface Compensation {
  field: string;
  original: string;
  compensated: string;
  reason: string;
}

export interface TransformResult {
  value: string;
  valid: boolean;
  compensated: boolean;
  reason?: string;
}

function digitsOnly(raw: string | number | undefined | null): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * Google Sheets may strip a leading 0, or store +27 / 27 country-code forms.
 * Always try to produce a 10-digit SA number starting with 0.
 */
export function transformMobile(raw: string | number | undefined | null): TransformResult {
  const original = String(raw ?? "").trim();
  let digits = digitsOnly(raw);

  if (digits.length === 0) {
    return {
      value: "0600000000",
      valid: true,
      compensated: true,
      reason: "Mobile number was empty; filled placeholder 0600000000",
    };
  }

  let compensated = false;
  let reason: string | undefined;

  // 27XXXXXXXXX (11) or 27 + 9 subscriber digits
  if (digits.length === 11 && digits.startsWith("27")) {
    digits = `0${digits.slice(2)}`;
    compensated = true;
    reason = `Mobile "${original}" had country code 27; converted to "${digits}"`;
  } else if (digits.length === 12 && digits.startsWith("27")) {
    digits = `0${digits.slice(2)}`.slice(0, 10);
    compensated = true;
    reason = `Mobile "${original}" had country code 27; converted to "${digits}"`;
  }

  if (digits.length === 9 && !digits.startsWith("0")) {
    digits = `0${digits}`;
    compensated = true;
    reason = `Mobile "${original}" was 9 digits; prepended 0 → "${digits}"`;
  }

  if (digits.length < 10) {
    const padded = digits.padStart(10, "0");
    return {
      value: padded,
      valid: true,
      compensated: true,
      reason: `Mobile "${original}" was ${digitsOnly(raw).length} digits; padded to "${padded}"`,
    };
  }

  if (digits.length > 10) {
    const trimmed = digits.startsWith("0") ? digits.slice(0, 10) : digits.slice(-10);
    return {
      value: trimmed,
      valid: true,
      compensated: true,
      reason: `Mobile "${original}" was ${digits.length} digits; trimmed to "${trimmed}"`,
    };
  }

  if (!digits.startsWith("0")) {
    const padded = `0${digits.slice(0, 9)}`;
    return {
      value: padded,
      valid: true,
      compensated: true,
      reason: `Mobile "${original}" did not start with 0; compensated to "${padded}"`,
    };
  }

  return { value: digits, valid: true, compensated, reason };
}

/** RSA ID Luhn-style check digit for the first 12 digits. */
export function saIdCheckDigit(first12: string): string {
  let oddSum = 0;
  for (let i = 0; i < 12; i += 2) {
    oddSum += parseInt(first12[i], 10);
  }
  let evenDigits = "";
  for (let i = 1; i < 12; i += 2) {
    evenDigits += first12[i];
  }
  const evenProduct = String(parseInt(evenDigits, 10) * 2);
  let evenSum = 0;
  for (const ch of evenProduct) {
    evenSum += parseInt(ch, 10);
  }
  return String((10 - ((oddSum + evenSum) % 10)) % 10);
}

function isValidSaIdDate(id13: string): boolean {
  const mm = parseInt(id13.slice(2, 4), 10);
  const dd = parseInt(id13.slice(4, 6), 10);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

/**
 * RSA ID numbers are 13 digits. Short values (Sheets truncation, missing digits)
 * are left-padded with zeros and given a valid checksum so the form can accept them.
 */
export function transformIdNumber(raw: string | number | undefined | null): TransformResult {
  const original = String(raw ?? "").trim();

  // Sheets sometimes emits scientific notation for long numbers
  let source = original;
  if (/e\+/i.test(source)) {
    const n = Number(source);
    if (Number.isFinite(n)) source = n.toFixed(0);
  }

  let digits = digitsOnly(source);

  if (digits.length === 0) {
    const dummy12 = "900101000008";
    const dummy = dummy12 + saIdCheckDigit(dummy12);
    return {
      value: dummy,
      valid: true,
      compensated: true,
      reason: `ID number was empty; filled structurally valid placeholder "${dummy}"`,
    };
  }

  if (digits.length > 13) {
    digits = digits.slice(-13);
  }

  if (digits.length < 13) {
    digits = digits.padStart(13, "0");
  }

  const first12 = digits.slice(0, 12);
  const withChecksum = first12 + saIdCheckDigit(first12);
  const dateOk = isValidSaIdDate(withChecksum);

  const changed = withChecksum !== digitsOnly(original) && withChecksum !== original;
  if (changed || !dateOk) {
    const reasons = [
      digitsOnly(original).length !== 13
        ? `ID "${original}" was ${digitsOnly(original).length} digits; padded to 13`
        : null,
      withChecksum !== digits
        ? `checksum corrected to "${withChecksum}"`
        : null,
      !dateOk
        ? "YYMMDD portion is not a valid calendar date (form may still warn)"
        : null,
    ].filter(Boolean);
    return {
      value: withChecksum,
      valid: true,
      compensated: true,
      reason: reasons.join("; "),
    };
  }

  return { value: withChecksum, valid: true, compensated: false };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Accept several common date shapes and emit the form's `MM DD YYYY`.
 */
export function transformDate(
  raw: string | undefined | null,
  fieldLabel: string
): TransformResult {
  const original = String(raw ?? "").trim();
  if (!original) {
    return {
      value: "01 01 2020",
      valid: true,
      compensated: true,
      reason: `${fieldLabel} was empty; filled placeholder "01 01 2020"`,
    };
  }

  if (/^\d{2}\s+\d{2}\s+\d{4}$/.test(original)) {
    return { value: original, valid: true, compensated: false };
  }

  const spaced = original.replace(/[./-]/g, " ").replace(/\s+/g, " ").trim();
  const parts = spaced.split(" ");

  if (parts.length === 3) {
    let [a, b, c] = parts;
    if (c.length === 2) c = `20${c}`;
    const n1 = parseInt(a, 10);
    const n2 = parseInt(b, 10);
    const n3 = parseInt(c, 10);

    if (Number.isFinite(n1) && Number.isFinite(n2) && Number.isFinite(n3)) {
      // ISO-ish YYYY MM DD
      if (a.length === 4) {
        const value = `${pad2(n2)} ${pad2(n3)} ${n1}`;
        return {
          value,
          valid: true,
          compensated: true,
          reason: `${fieldLabel} "${original}" rewritten as "${value}"`,
        };
      }
      // Assume MM DD YYYY (sheet convention), pad single digits
      if (n1 >= 1 && n1 <= 12 && n2 >= 1 && n2 <= 31 && String(n3).length === 4) {
        const value = `${pad2(n1)} ${pad2(n2)} ${n3}`;
        const compensated = value !== original;
        return {
          value,
          valid: true,
          compensated,
          reason: compensated
            ? `${fieldLabel} "${original}" padded to "${value}"`
            : undefined,
        };
      }
      // DD MM YYYY fallback when first part looks like a day
      if (n1 > 12 && n1 <= 31 && n2 >= 1 && n2 <= 12 && String(n3).length === 4) {
        const value = `${pad2(n2)} ${pad2(n1)} ${n3}`;
        return {
          value,
          valid: true,
          compensated: true,
          reason: `${fieldLabel} "${original}" interpreted as DD MM YYYY → "${value}"`,
        };
      }
    }
  }

  // Excel serial date (days since 1899-12-30)
  if (/^\d{4,5}$/.test(original)) {
    const serial = parseInt(original, 10);
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + serial * 86400000);
    if (!Number.isNaN(date.getTime())) {
      const value = `${pad2(date.getUTCMonth() + 1)} ${pad2(date.getUTCDate())} ${date.getUTCFullYear()}`;
      return {
        value,
        valid: true,
        compensated: true,
        reason: `${fieldLabel} Excel serial ${original} → "${value}"`,
      };
    }
  }

  return {
    value: "01 01 2020",
    valid: true,
    compensated: true,
    reason: `${fieldLabel} "${original}" was unparseable; filled placeholder "01 01 2020"`,
  };
}

/** @deprecated Use transformDate — kept for callers that still expect the old shape. */
export function validateDateFormat(
  raw: string | undefined | null,
  fieldLabel: string
): { value: string; valid: boolean; needsManualReview: boolean; reason?: string } {
  const result = transformDate(raw, fieldLabel);
  return {
    value: result.value,
    valid: true,
    needsManualReview: result.compensated,
    reason: result.reason,
  };
}

export interface SplitNameResult {
  firstName: string;
  surname: string;
  compensated: boolean;
  reason?: string;
}

/** Split a combined "First Last" (or "First Middle Last") cell on the last space. */
export function splitFullName(raw: string | undefined | null): SplitNameResult {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) {
    return {
      firstName: "Unknown",
      surname: "Applicant",
      compensated: true,
      reason: "Name was empty; filled Unknown Applicant",
    };
  }

  const lastSpace = value.lastIndexOf(" ");
  if (lastSpace <= 0) {
    return {
      firstName: value,
      surname: "Unknown",
      compensated: true,
      reason: `Could not split surname from "${value}"; used surname "Unknown"`,
    };
  }

  return {
    firstName: value.slice(0, lastSpace).trim(),
    surname: value.slice(lastSpace + 1).trim(),
    compensated: false,
  };
}

export function fallbackText(raw: string | undefined | null, placeholder: string, field: string): TransformResult {
  const value = String(raw ?? "").trim();
  if (value) return { value, valid: true, compensated: false };
  return {
    value: placeholder,
    valid: true,
    compensated: true,
    reason: `${field} was empty; filled "${placeholder}"`,
  };
}

export function fallbackAmount(raw: string | undefined | null, field: string): TransformResult {
  const value = String(raw ?? "").trim();
  if (value) return { value: value.replace(/[^\d.]/g, "") || "0", valid: true, compensated: false };
  return {
    value: "0",
    valid: true,
    compensated: true,
    reason: `${field} was empty; filled 0`,
  };
}

export function pushCompensation(
  list: Compensation[],
  field: string,
  original: string,
  result: TransformResult | SplitNameResult,
  compensatedValue?: string
): void {
  if (!result.compensated) return;
  list.push({
    field,
    original,
    compensated: compensatedValue ?? ("value" in result ? result.value : ""),
    reason: result.reason ?? `${field} was compensated`,
  });
}

export function normalizeCompareValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function valuesMatch(expected: string, actual: string): boolean {
  const a = normalizeCompareValue(expected);
  const b = normalizeCompareValue(actual);
  if (a === b) return true;
  const aDigits = a.replace(/\s/g, "");
  const bDigits = b.replace(/\s/g, "");
  if (/^\d+$/.test(aDigits) && aDigits === bDigits) return true;
  return false;
}
