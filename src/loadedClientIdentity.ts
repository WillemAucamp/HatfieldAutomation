import { transformMobile } from "./transforms.js";

/**
 * Canonical SA mobile: 10 digits starting with 0.
 * Sheets often stores 715316597 (leading 0 dropped) or 27715316597.
 */
export function normalizeLoadedPhone(raw: string | number | null | undefined): string {
  let text = String(raw ?? "").trim();
  if (/e\+/i.test(text)) {
    const asNumber = Number(text);
    if (Number.isFinite(asNumber)) text = String(Math.round(asNumber));
  }
  const result = transformMobile(text);
  return result.valid ? result.value : "";
}

/**
 * Hidden-apostrophe form so Sheets setValue keeps the trunk 0.
 * Falls back to the raw text when it is not a normal SA mobile, so a load is still written.
 */
export function sheetTextPhone(phone: string): string {
  const normalized = normalizeLoadedPhone(phone);
  const value = normalized || String(phone ?? "").trim().replace(/^'/, "");
  return value ? `'${value}` : "";
}

export function normalizeLoadedName(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function collapseDoubledToken(name: string): string {
  const parts = name.split(" ");
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
  return name;
}

/** Same client, including a doubled-token surname artefact ("Nazile Nazile"). */
export function sameLoadedPerson(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeLoadedName(a);
  const right = normalizeLoadedName(b);
  if (!left || !right) return false;
  return collapseDoubledToken(left) === collapseDoubledToken(right);
}

export function preferRicherName(existing: string, incoming: string): string {
  const current = existing.trim().replace(/\s+/g, " ");
  const next = incoming.trim().replace(/\s+/g, " ");
  if (!current) return next;
  if (!next) return current;
  const doubled = (value: string) => {
    const parts = value.toLowerCase().split(" ");
    return parts.length === 2 && parts[0] === parts[1];
  };
  if (doubled(current) && !doubled(next)) return next;
  if (doubled(next) && !doubled(current)) return current;
  return current.length >= next.length ? current : next;
}

export interface LoadedIdentityRow {
  rowIndex: number;
  name: string;
  number: string;
}

export type LoadedUpsertPlan =
  | { action: "present"; rowIndex: number }
  | { action: "update"; rowIndex: number; name: string; number: string }
  | { action: "append"; sharedPhoneName?: string };

/**
 * Decide how a successful Seriti load lands on the Leads tab.
 * A shared cellphone must not hide a different person (that dropped clients).
 * The same person must not be appended again when the stored number lost its 0.
 */
export function planLoadedUpsert(
  rows: LoadedIdentityRow[],
  name: string,
  number: string
): LoadedUpsertPlan {
  const phone = normalizeLoadedPhone(number);
  const incomingName = name.trim().replace(/\s+/g, " ");

  for (const row of rows) {
    if (!sameLoadedPerson(row.name, incomingName)) continue;
    const existingPhone = normalizeLoadedPhone(row.number);
    if (!phone || existingPhone === phone) {
      return { action: "present", rowIndex: row.rowIndex };
    }
    return {
      action: "update",
      rowIndex: row.rowIndex,
      name: preferRicherName(row.name, incomingName),
      number: phone,
    };
  }

  if (phone) {
    const blankName = rows.find(
      (row) => !row.name.trim() && normalizeLoadedPhone(row.number) === phone
    );
    if (blankName) {
      return {
        action: "update",
        rowIndex: blankName.rowIndex,
        name: incomingName,
        number: phone,
      };
    }
    const shared = rows.find((row) => normalizeLoadedPhone(row.number) === phone);
    if (shared) {
      return { action: "append", sharedPhoneName: shared.name };
    }
  }

  return { action: "append" };
}

export interface ApprovedLeadRow {
  rowIndex: number;
  name: string;
  number: string;
  status: string;
}

/** True when this approved client is not already on the Approved follow-up tab. */
export function approvedRowMissing(
  approvedTab: Array<{ name: string; number: string }>,
  name: string,
  number: string
): boolean {
  const phone = normalizeLoadedPhone(number);
  return !approvedTab.some((row) => {
    if (sameLoadedPerson(row.name, name)) return true;
    if (phone && !row.name.trim() && normalizeLoadedPhone(row.number) === phone) return true;
    return false;
  });
}

/**
 * Approved leads the F&I tab does not have yet.
 * Only the recent window is copied, so old approvals are not dumped onto the working list.
 */
export function approvedLeadsToCarry(
  leads: ApprovedLeadRow[],
  approvedTab: Array<{ name: string; number: string }>,
  windowRows = 120
): ApprovedLeadRow[] {
  const named = leads.filter((row) => row.name.trim());
  if (named.length === 0) return [];
  const last = Math.max(...named.map((row) => row.rowIndex));
  const floor = last - windowRows;
  const carry: ApprovedLeadRow[] = [];
  for (const row of named) {
    if (row.rowIndex < floor) continue;
    if (row.status.trim().toLowerCase() !== "approved") continue;
    if (!normalizeLoadedPhone(row.number)) continue;
    if (!approvedRowMissing(approvedTab, row.name, row.number)) continue;
    carry.push(row);
  }
  return carry;
}
