/** Normalise Leads Status for comparisons (trim, lower case, single spaces). */
export function normalizeLeadStatus(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Status values that belong on the Approved follow-up tab.
 * Includes "Approved no message sent" (WhatsApp skipped) as well as plain Approved.
 */
export function isApprovedForCarryTab(status: string | null | undefined): boolean {
  const s = normalizeLeadStatus(status);
  return s === "approved" || s === "approved no message sent";
}

/** True when a webhook/sheet write set Status to a carry-eligible approval. */
export function statusWriteCarriesToApprovedTab(value: string | null | undefined): boolean {
  return isApprovedForCarryTab(value);
}
