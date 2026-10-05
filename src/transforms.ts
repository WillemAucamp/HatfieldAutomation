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

export function restorePostalCode(raw: string | number | undefined | null): string {
  const original = String(raw ?? "").trim();
  const digits = digitsOnly(raw);
  // Sheets strips leading zeros from numeric postal cells (0300 → 300).
  if (digits.length > 0 && digits.length < 4) {
    return digits.padStart(4, "0");
  }
  return original || digits;
}

/** Words that are not useful for postal suburb/town autocomplete search. */
const NON_PLACE_WORDS = new Set([
  "base",
  "house",
  "street",
  "road",
  "avenue",
  "drive",
  "lane",
  "court",
  "crescent",
  "training",
  "formation",
  "services",
  "military",
  "samhs",
  "pty",
  "ltd",
  "ext",
  "intermodal",
  "deep",
  "city",
  "online",
  "search",
  "unknown",
  "area",
  "number",
  "no",
]);

const PROVINCE_CITY_HINTS: Record<string, string[]> = {
  gauteng: ["Pretoria", "Johannesburg", "Tshwane", "Sandton", "Midrand"],
  mpumalanga: ["Nelspruit", "Witbank", "Mbombela", "Hendrina", "Middelburg"],
  "western cape": ["Cape Town", "Kuilsriver", "Bellville", "Parow"],
  "kwazulu-natal": ["Durban", "Pietermaritzburg"],
  "free state": ["Bloemfontein"],
  "north west": ["Rustenburg", "Mahikeng"],
  limpopo: ["Polokwane"],
  "eastern cape": ["Port Elizabeth", "Gqeberha"],
  "northern cape": ["Kimberley"],
};

function placeTokensFromAddress(address: string): string[] {
  const tokens: string[] = [];

  if (/thaba\s+tshwane/i.test(address)) {
    tokens.push("Thaba Tshwane", "Tshwane", "Pretoria");
  }

  const multiWord = address.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) ?? [];
  for (const phrase of multiWord) {
    tokens.push(phrase);
    const parts = phrase.split(/\s+/);
    if (parts.length > 1) tokens.push(parts[parts.length - 1]!);
  }

  const words = address.match(/[A-Za-z][A-Za-z-]+/g) ?? [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (word.length >= 4 && !NON_PLACE_WORDS.has(lower)) {
      tokens.push(word);
    }
  }

  return [...new Set(tokens)];
}

/** Search terms for angucomplete postal lookup — code alone often fails outside Gauteng. */
export function postalSearchNeedles(
  postalCode: string,
  addressLine = "",
  province = ""
): string[] {
  const code = restorePostalCode(postalCode);
  const needles: string[] = [code];
  const address = String(addressLine ?? "").trim();

  const townAtEnd = address.match(/\b([A-Za-z][A-Za-z\s-]+?)\s+\d{4}\s*$/);
  if (townAtEnd) {
    const town = townAtEnd[1].trim().split(/\s+/).pop() ?? townAtEnd[1].trim();
    needles.push(`${code} ${town}`, `${town}, ${code}`, town);
  }

  for (const token of placeTokensFromAddress(address)) {
    needles.push(`${code} ${token}`, token);
  }

  const cities = PROVINCE_CITY_HINTS[province.trim().toLowerCase()] ?? [];
  for (const city of cities) {
    needles.push(`${code} ${city}`);
  }

  return [...new Set(needles.filter(Boolean))];
}

/** Shorten noisy military-base addresses so they pass suburb/postal validation. */
export function normalizeAddressLine(address: string): string {
  const trimmed = String(address ?? "").trim();
  if (/thaba\s+tshwane/i.test(trimmed)) return "Thaba Tshwane Military Base";
  return trimmed;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Convert sheet dates (`MM DD YYYY`) to the finance form date-picker display (`DD Mon YYYY`). */
export function formatDateForForm(raw: string | undefined | null): string {
  const trimmed = coerceToMmDdYyyy(raw);
  const spaced = trimmed.match(/^(\d{2})\s+(\d{2})\s+(\d{4})$/);
  if (spaced) {
    const month = Number(spaced[1]);
    const day = Number(spaced[2]);
    const year = spaced[3];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, "0")} ${MONTH_ABBR[month - 1]} ${year}`;
    }
  }
  return trimmed;
}

/**
 * Google Sheets may strip a leading 0 from numeric ID cells (0104205209083 → 104205209083).
 * Only that known artefact is corrected: 12 digits → prepend 0.
 */
export function restoreIdNumber(raw: string | number | undefined | null): string {
  const digits = digitsOnly(raw);
  if (digits.length === 12) return `0${digits}`;
  return digits || String(raw ?? "").trim();
}

/**
 * RSA ID numbers must be exactly 13 digits. Short/long/empty values are treated
 * as human error — except a single leading zero stripped by Sheets (12 digits).
 */
export function validateIdNumber(raw: string | number | undefined | null): TransformResult {
  const original = String(raw ?? "").trim();
  let source = original;
  if (/e\+/i.test(source)) {
    const n = Number(source);
    if (Number.isFinite(n)) source = n.toFixed(0);
  }

  let digits = digitsOnly(source);
  if (digits.length === 12) {
    digits = restoreIdNumber(digits);
  }

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
      message: `ID number is not 13 digits (got ${digitsOnly(source).length}: "${original}")`,
    };
  }

  return { value: digits, valid: true };
}

const DATE_PATTERN = /^\d{2}\s+\d{2}\s+\d{4}$/;

/**
 * Apps Script readSheet formats Google Date cells as `yyyy-MM-dd HH:mm:ss`
 * (often with a timezone offset like 02:00:00). The form still wants MM DD YYYY.
 */
export function coerceToMmDdYyyy(raw: string | undefined | null): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (DATE_PATTERN.test(value)) return value;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    return `${iso[2]} ${iso[3]} ${iso[1]}`;
  }

  const spacedYmd = value.match(/^(\d{4})\s+(\d{2})\s+(\d{2})$/);
  if (spacedYmd) {
    return `${spacedYmd[2]} ${spacedYmd[3]} ${spacedYmd[1]}`;
  }

  return value;
}

export function validateDateFormat(
  raw: string | undefined | null,
  fieldLabel: string,
  emptyCode: string,
  formatCode: string
): TransformResult {
  const original = String(raw ?? "").trim();
  const value = coerceToMmDdYyyy(original);

  if (!value || isMissingValue(value)) {
    return {
      value: original,
      valid: false,
      code: emptyCode,
      message: `${fieldLabel} is empty`,
    };
  }

  if (!DATE_PATTERN.test(value)) {
    return {
      value: original,
      valid: false,
      code: formatCode,
      message: `${fieldLabel} must be MM DD YYYY (got "${original}")`,
    };
  }

  return { value, valid: true };
}

export function isMissingValue(raw: string | undefined | null): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return true;
  return /^(unknown|n\/a|na|none|-|null|undefined)$/i.test(value);
}

export interface SplitNameResult {
  firstName: string;
  surname: string;
  initials: string;
  valid: boolean;
  code?: string;
  message?: string;
}

export function initialsFromFirstNames(firstName: string): string {
  return String(firstName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/**
 * Last token is the surname; everything before is first names.
 * Initials are derived from first-name tokens in code (Willem → W, Willem Christoffel → WC).
 * A one-letter last token ("Willem A") is not a surname.
 */
export function parsePersonName(
  raw: string | undefined | null,
  emptyCode = "NAME_EMPTY",
  surnameCode = "NAME_MISSING_SURNAME",
  label = "Applicant name"
): SplitNameResult {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!value || isMissingValue(value)) {
    return {
      firstName: "",
      surname: "",
      initials: "",
      valid: false,
      code: emptyCode,
      message: `${label} is empty`,
    };
  }

  const parts = value.split(" ");
  if (parts.length < 2) {
    return {
      firstName: value,
      surname: "",
      initials: initialsFromFirstNames(value),
      valid: false,
      code: surnameCode,
      message: `${label} "${value}" has no surname (expected "First Last")`,
    };
  }

  const surname = parts[parts.length - 1]!;
  const firstName = parts.slice(0, -1).join(" ").trim();
  const initials = initialsFromFirstNames(firstName);
  if (surname.length < 2) {
    return {
      firstName,
      surname,
      initials,
      valid: false,
      code: surnameCode,
      message: `${label} "${value}" does not have a full surname`,
    };
  }

  return { firstName, surname, initials, valid: true };
}

/** Split a combined "First Last" cell on the last space. Incomplete names are errors. */
export function splitFullName(
  raw: string | undefined | null,
  emptyCode: string,
  surnameCode: string,
  label: string
): SplitNameResult {
  return parsePersonName(raw, emptyCode, surnameCode, label);
}

/** Next of kin uses the same split. A single given name is an error, not a duplicated surname. */
export function splitNextOfKinName(raw: string | undefined | null): SplitNameResult {
  return parsePersonName(
    raw,
    "NEXT_OF_KIN_EMPTY",
    "NEXT_OF_KIN_MISSING_SURNAME",
    "Next of kin name"
  );
}

export function titleFromGender(raw: string | undefined | null): TransformResult {
  const value = String(raw ?? "").trim();
  if (isMissingValue(value)) {
    return {
      value: "",
      valid: false,
      code: "TITLE_EMPTY",
      message: "Gender/title is missing on the intake sheet",
    };
  }
  const g = value.toLowerCase();
  if (/^(m|male|man|mr)\b/.test(g) || g === "m") return { value: "Mr", valid: true };
  if (/^mrs\b/.test(g)) return { value: "Mrs", valid: true };
  if (/^(ms|miss)\b/.test(g)) return { value: "Ms", valid: true };
  if (/^(f|female|woman)\b/.test(g) || g === "f") return { value: "Ms", valid: true };
  if (/^(dr|doctor)\b/.test(g)) return { value: "Dr", valid: true };
  return {
    value: "",
    valid: false,
    code: "TITLE_UNMAPPED",
    message: `Cannot derive title from intake gender "${value}"`,
  };
}

/** "3 years", "6 months", "2 years 3 months" → MM DD YYYY relative to today. */
export function parseDurationToMmDdYyyy(
  raw: string | undefined | null,
  today: Date = new Date()
): string | null {
  const coerced = coerceToMmDdYyyy(raw);
  if (DATE_PATTERN.test(coerced)) return coerced;
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || isMissingValue(value)) return null;

  let years = 0;
  let months = 0;
  const yearMatch = value.match(/(\d+)\s*(year|years|yr|yrs)\b/);
  const monthMatch = value.match(/(\d+)\s*(month|months|mo)\b/);
  if (yearMatch) years = Number(yearMatch[1]);
  if (monthMatch) months = Number(monthMatch[1]);
  if (!yearMatch && !monthMatch) return null;

  const date = new Date(today.getTime());
  date.setFullYear(date.getFullYear() - years);
  date.setMonth(date.getMonth() - months);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${mm} ${dd} ${yyyy}`;
}

export function requireText(
  raw: string | undefined | null,
  code: string,
  message: string
): TransformResult {
  const value = String(raw ?? "").trim();
  if (isMissingValue(value)) {
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
  if (isMissingValue(value)) {
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
    { keys: ["matric", "grade 12", "grade12"], terms: ["MATRIC", "GRADE 12"] },
    { keys: ["rsa id", "rsa"], terms: ["RSA"] },
    { keys: ["labourer", "laborer"], terms: ["LABOURER", "LABORER"] },
    { keys: ["skilled worker"], terms: ["SKILLED"] },
    { keys: ["business services"], terms: ["BUSINESS SERVICES"] },
    { keys: ["gauteng", "gp"], terms: ["GAUTENG"] },
    { keys: ["western cape", "wc"], terms: ["WESTERN CAPE"] },
    { keys: ["kwazulu natal", "kwazulu-natal", "kzn"], terms: ["KWAZULU"] },
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
