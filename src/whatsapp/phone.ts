/**
 * Normalize South African mobile numbers for WhatsApp APIs.
 * Accepts 0XXXXXXXXX, +27XXXXXXXXX, 27XXXXXXXXX, and spaced/dashed variants.
 */
export function normalizeSaWhatsappPhone(raw: string | number | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";

  let national = digits;
  if (national.startsWith("27") && national.length >= 11) {
    national = national.slice(2);
  }
  if (national.startsWith("0") && national.length >= 10) {
    national = national.slice(1);
  }
  // SA mobiles are 9 digits after country/trunk (e.g. 82xxxxxxx)
  if (national.length !== 9) {
    return "";
  }
  return `27${national}`;
}

export function isNotifiableLeadStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "approved" || normalized === "declined";
}

export function templateKeyForStatus(status: string): "approve" | "decline" | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "approved") return "approve";
  if (normalized === "declined") return "decline";
  return null;
}
