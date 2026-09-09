export function normalizeHeader(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function cell(row: Record<string, string>, header: string): string {
  if (Object.prototype.hasOwnProperty.call(row, header)) {
    return String(row[header] ?? "").trim();
  }
  const want = normalizeHeader(header);
  for (const [key, value] of Object.entries(row)) {
    if (normalizeHeader(key) === want) return String(value ?? "").trim();
  }
  for (const [key, value] of Object.entries(row)) {
    const have = normalizeHeader(key);
    if (have.includes(want) || want.includes(have)) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
  }
  return "";
}

export function firstFilled(row: Record<string, string>, headers: string[]): string {
  for (const header of headers) {
    const value = cell(row, header);
    if (value) return value;
  }
  return "";
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
