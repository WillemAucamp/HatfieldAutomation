export function normalizeHeader(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop example / hint suffixes so Form title drift still matches. */
export function coreHeader(value: string): string {
  return normalizeHeader(value)
    .replace(/\bexample\b.*$/i, "")
    .replace(/\bcannot be the same as yours\b.*$/i, "")
    .replace(/[?:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(value: string): string[] {
  return coreHeader(value)
    .split(" ")
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 3)
    .filter((token) => !["example", "your", "the", "and", "for", "with", "from"].includes(token));
}

function headersCompatible(have: string, want: string): boolean {
  const a = coreHeader(have);
  const b = coreHeader(want);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const aTokens = significantTokens(have);
  const bTokens = significantTokens(want);
  if (!bTokens.length) return false;
  // Require every significant token from the shorter side to appear in the longer.
  const [shorter, longer] =
    aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  if (shorter.length < 2) return false;
  return shorter.every((token) => longer.includes(token));
}

export function findHeaderKey(
  row: Record<string, string>,
  header: string
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(row, header)) return header;
  const want = normalizeHeader(header);
  for (const key of Object.keys(row)) {
    if (normalizeHeader(key) === want) return key;
  }
  for (const key of Object.keys(row)) {
    if (headersCompatible(key, header)) return key;
  }
  return undefined;
}

export function cell(row: Record<string, string>, header: string): string {
  const key = findHeaderKey(row, header);
  if (!key) return "";
  return String(row[key] ?? "").trim();
}

export function firstFilled(row: Record<string, string>, headers: string[]): string {
  for (const header of headers) {
    const value = cell(row, header);
    if (value) return value;
  }
  return "";
}

/** Join several Form columns (e.g. next-of-kin first + surname) with spaces. */
export function joinFilled(row: Record<string, string>, headers: string[]): string {
  return headers
    .map((header) => cell(row, header))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasConsent(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  if (!s) return false;
  if (/^(no|n|false|unchecked)\b/.test(s)) return false;
  if (/\b(no|disagree|do not|don't)\b/.test(s) && !/\byes\b/.test(s)) return false;
  return /\byes\b|\btrue\b|\bok\b|\bagree\b|\bconsent\b|\bpermission\b|\bi do\b/.test(s);
}

export function flattenRow(row: Record<string, string>): string {
  return Object.entries(row)
    .filter(([, value]) => String(value ?? "").trim())
    .map(([key, value]) => `${key}: ${String(value).trim()}`)
    .join("\n");
}

/**
 * Fail loudly when expected Form headers are absent from a live sheet row.
 * Uses the same fuzzy match as cell() so example-text drift is tolerated, but a
 * completely renamed or missing question still aborts the run.
 */
export function missingIntakeHeaders(
  liveHeaders: string[],
  expectedHeaders: string[]
): string[] {
  const liveRow: Record<string, string> = {};
  for (const header of liveHeaders) liveRow[header] = "1";
  return expectedHeaders.filter((expected) => !findHeaderKey(liveRow, expected));
}

export function assertIntakeHeadersPresent(
  liveHeaders: string[],
  expectedHeaders: string[]
): void {
  const missing = missingIntakeHeaders(liveHeaders, expectedHeaders);
  if (missing.length === 0) return;
  throw new Error(
    `Intake sheet is missing ${missing.length} expected Form header(s). ` +
      `Update config/intake-mapping.yaml intake_headers or the Google Form. Missing: ${missing.join(" | ")}`
  );
}
