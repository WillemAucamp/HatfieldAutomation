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

/** Search terms for angucomplete postal lookup — code alone often fails outside Gauteng. */
export function restorePostalCode(raw: string | number | undefined | null): string {
  const original = String(raw ?? "").trim();
  const digits = digitsOnly(raw);
  // Sheets strips leading zeros from numeric postal cells (0300 → 300).
  if (digits.length > 0 && digits.length < 4) {
    return digits.padStart(4, "0");
  }
  return original || digits;
}

export function postalSearchNeedles(postalCode: string, addressLine = ""): string[] {
  const code = restorePostalCode(postalCode);
  const needles = [code];
  const address = String(addressLine ?? "").trim();
  const townAtEnd = address.match(/\b([A-Za-z][A-Za-z\s-]+?)\s+\d{4}\s*$/);
  if (townAtEnd) {
    const town = townAtEnd[1].trim().split(/\s+/).pop() ?? townAtEnd[1].trim();
    needles.push(`${code} ${town}`, `${town}, ${code}`, town);
  } else {
    const words = address.match(/[A-Za-z][A-Za-z-]+/g) ?? [];
    for (const word of words.slice(-2).reverse()) {
      needles.push(`${code} ${word}`, word);
    }
  }
  return [...new Set(needles.filter(Boolean))];
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

/**
 * Next of kin must still have a first name. If the sheet only has one word,
 * reuse it as the surname so the form can be submitted.
 */
export function splitNextOfKinName(raw: string | undefined | null): SplitNameResult {
  const split = splitFullName(
    raw,
    "NEXT_OF_KIN_EMPTY",
    "NEXT_OF_KIN_MISSING_SURNAME",
    "Next of kin name"
  );
  if (!split.valid && split.code === "NEXT_OF_KIN_MISSING_SURNAME" && split.firstName) {
    return { firstName: split.firstName, surname: split.firstName, valid: true };
  }
  return split;
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

/**
 * Sheet nicknames → search terms for the live finance dropdown.
 * FNB must not rely on substring "fnb" inside "FIRSTRAND BANK LIMITED".
 */
export function expandSelectNeedles(raw: string): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];

  const lower = value.toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ");
  const aliasTable: Array<{ keys: string[]; terms: string[] }> = [
    { keys: ["fnb", "first national", "firstrand"], terms: ["FIRSTRAND", "FIRST NATIONAL", "FNB"] },
    { keys: ["capitec"], terms: ["CAPITEC"] },
    { keys: ["nedbank"], terms: ["NEDBANK"] },
    {
      keys: ["standard bank", "standardbank", "standard"],
      terms: ["STANDARD BANK", "STANDARD"],
    },
    { keys: ["absa"], terms: ["ABSA"] },
    { keys: ["african bank"], terms: ["AFRICAN BANK"] },
    { keys: ["discovery"], terms: ["DISCOVERY"] },
    { keys: ["tyme", "tymebank", "tyme bank"], terms: ["TYME"] },
    { keys: ["investec"], terms: ["INVESTEC"] },
    { keys: ["bidvest"], terms: ["BIDVEST"] },
    { keys: ["old mutual"], terms: ["OLD MUTUAL"] },
    { keys: ["savings transactional", "savings/transactional", "transactional"], terms: ["SAVINGS"] },
    { keys: ["cheque current", "cheque/current", "current cheque"], terms: ["CURRENT", "CHEQUE"] },
    { keys: ["savings"], terms: ["SAVINGS"] },
    { keys: ["cheque"], terms: ["CHEQUE", "CURRENT"] },
    { keys: ["current"], terms: ["CURRENT", "CHEQUE"] },
  ];

  for (const { keys, terms } of aliasTable) {
    if (keys.some((key) => lower === key || lower.startsWith(`${key} `))) {
      return uniqueNeedles([value, ...terms]);
    }
  }

  return [value];
}

function uniqueNeedles(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function valuesMatch(expected: string, actual: string): boolean {
  const a = normalizeCompareValue(expected);
  const b = normalizeCompareValue(actual);
  if (a === b) return true;
  if (a.length >= 3 && b.includes(a)) return true;
  if (b.length >= 3 && a.includes(b)) return true;
  const needles = expandSelectNeedles(expected).map((n) => n.toLowerCase());
  if (needles.some((n) => n.length >= 3 && b.includes(n))) return true;
  const aNum = parseFloat(a.replace(/[r$€,\s]/gi, "").replace(/[^\d.]/g, ""));
  const bNum = parseFloat(b.replace(/[r$€,\s]/gi, "").replace(/[^\d.]/g, ""));
  if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum === bNum) return true;
  return false;
}
