/** Normalise Leads Status for comparisons (trim, lower case, underscores → spaces). */
export function normalizeLeadStatus(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Status values that belong on the Approved follow-up tab.
 * Includes plain Approved and no-WhatsApp variants (sheet uses several spellings).
 */
export function isApprovedForCarryTab(status: string | null | undefined): boolean {
  const s = normalizeLeadStatus(status);
  if (s === "approved") return true;
  if (s === "approved no message sent") return true;
  if (/^approve(d)?\b/.test(s) && /\bno message\b/.test(s)) return true;
  return false;
}

/** True when a webhook/sheet write set Status to a carry-eligible approval. */
export function statusWriteCarriesToApprovedTab(value: string | null | undefined): boolean {
  return isApprovedForCarryTab(value);
}
