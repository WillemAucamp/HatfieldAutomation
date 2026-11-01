import { loadIntakeMapping } from "./intake/mapping.js";
import { cell } from "./intake/headers.js";
import { matchIntakeRow } from "./intake/matchIntake.js";
import { readSheetRows } from "./intake/sheets.js";
import { parseReferenceNumber } from "./reference.js";
import { postWebhookJson } from "./sheetWriter.js";
import type { ApplicantRecord, AppConfig } from "./types.js";

const VEHICLE_PLACEHOLDER =
  "(Vehicle from Application form could not be matched to this automation row.)";

let intakeRowsCache: Awaited<ReturnType<typeof readSheetRows>> | null = null;
let automationRowsCache: Awaited<ReturnType<typeof readSheetRows>> | null = null;

function automationRowCell(values: Record<string, string>, columnName: string): string {
  const direct = values[columnName];
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const found = Object.entries(values).find(
    ([header]) => header.trim().toLowerCase() === columnName.trim().toLowerCase()
  );
  return found ? String(found[1]).trim() : "";
}

/** Clear sheet caches between batch runs (tests and runBatch). */
export function resetEasysocialDraftCaches(): void {
  intakeRowsCache = null;
  automationRowsCache = null;
}

export function buildEasysocialSubject(
  clientName: string,
  bankName: string,
  reference: string
): string {
  const name = String(clientName ?? "").trim().replace(/\s+/g, " ");
  const bank = String(bankName ?? "").trim().replace(/\s+/g, " ");
  const ref =
    parseReferenceNumber(String(reference ?? "").trim()) ??
    String(reference ?? "").trim().toUpperCase();
  return `Easysocial: ${name} - ${bank} - ${ref}`;
}

export function isEasysocialDraftMarked(value: string | undefined | null): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (/^(yes|y|true|1|sent|drafted)$/i.test(v)) return true;
  if (/^draft:/i.test(v)) return true;
  return v.length > 8 && !/^no$/i.test(v);
}

function applicantAsAutomationRow(applicant: ApplicantRecord): Record<string, string> {
  return {
    Email: applicant.email,
    "ID number": applicant.idNumber,
    "Full name": `${applicant.firstName} ${applicant.surname}`.trim(),
    "Bank name": applicant.bank,
  };
}

export function resolveVehicleFromIntake(
  applicant: ApplicantRecord,
  intakeRows: Array<{ rowIndex: number; values: Record<string, string> }>,
  mapping: ReturnType<typeof loadIntakeMapping>,
  autoRowIndex: number
): { body: string; matched: boolean } {
  const auto = applicantAsAutomationRow(applicant);
  const match = matchIntakeRow(auto, intakeRows, mapping, autoRowIndex);
  if (!match) {
    return { body: VEHICLE_PLACEHOLDER, matched: false };
  }
  const vehicle = cell(match.values, mapping.intake_headers.vehicle_interest).trim();
  if (!vehicle) {
    return { body: VEHICLE_PLACEHOLDER, matched: false };
  }
  return { body: vehicle, matched: true };
}

async function loadIntakeRows(config: AppConfig) {
  if (intakeRowsCache) return intakeRowsCache;
  intakeRowsCache = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    sheetGid: config.intakeSheetGid,
    sheetName: config.intakeSheetName,
    unprocessedOnly: false,
  });
  return intakeRowsCache;
}

async function loadAutomationRows(config: AppConfig) {
  if (automationRowsCache) return automationRowsCache;
  automationRowsCache = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.sheetId,
    unprocessedOnly: false,
    statusColumn: "",
  });
  return automationRowsCache;
}

export interface EasysocialDraftResult {
  created: boolean;
  skipped?: boolean;
  reason?: string;
  subject?: string;
  draftId?: string;
  error?: string;
}

export async function createEasysocialDraftIfNeeded(
  config: AppConfig,
  applicant: ApplicantRecord,
  reference: string
): Promise<EasysocialDraftResult> {
  if (!config.easysocialDraftEnabled) {
    return { created: false, skipped: true, reason: "disabled" };
  }
  if (!config.sheetWebhookUrl) {
    return { created: false, error: "SHEET_WEBHOOK_URL is required for Easysocial drafts" };
  }
  if (config.easysocialRecipients.length !== 4) {
    return {
      created: false,
      error: `EASYSOCIAL_RECIPIENTS must list exactly 4 emails (got ${config.easysocialRecipients.length})`,
    };
  }

  const column = config.easysocialDraftColumn;
  try {
    const automationRows = await loadAutomationRows(config);
    const row = automationRows.find((r) => r.rowIndex === applicant.rowIndex);
    const marker = row ? automationRowCell(row.values, column) : "";
    if (isEasysocialDraftMarked(marker)) {
      return { created: false, skipped: true, reason: "already_drafted" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Easysocial draft: could not read idempotency column: ${msg}`);
  }

  const clientName = `${applicant.firstName} ${applicant.surname}`.trim();
  const subject = buildEasysocialSubject(clientName, applicant.bank, reference);

  let body = VEHICLE_PLACEHOLDER;
  try {
    const mapping = loadIntakeMapping(config.intakeMappingPath);
    const intakeRows = await loadIntakeRows(config);
    const resolved = resolveVehicleFromIntake(
      applicant,
      intakeRows,
      mapping,
      applicant.rowIndex
    );
    body = resolved.body;
    if (!resolved.matched) {
      console.warn(
        `Easysocial draft: no intake vehicle match for row ${applicant.rowIndex} (${clientName})`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Easysocial draft: intake read failed, using placeholder body: ${msg}`);
  }

  const to = [...config.easysocialRecipients];
  const cc = [...config.easysocialRecipients];

  try {
    const created = await postWebhookJson(config.sheetWebhookUrl, {
      action: "createEasysocialDraft",
      to,
      cc,
      subject,
      body,
      rowIndex: applicant.rowIndex,
      spreadsheetId: config.sheetId,
    });
    if (created.ok === false) {
      return {
        created: false,
        error: String(created.error || "createEasysocialDraft returned ok=false"),
      };
    }

    const draftId = String(created.draftId ?? created.messageId ?? "").trim();
    const markerValue = draftId ? `draft:${draftId}` : "yes";

    const mark = await postWebhookJson(config.sheetWebhookUrl, {
      action: "updateSheet",
      spreadsheetId: config.sheetId,
      updates: [{ row: applicant.rowIndex, column, value: markerValue }],
    });
    if (mark.ok === false) {
      console.warn(
        `Easysocial draft created but sheet marker failed: ${String(mark.error || "updateSheet failed")}`
      );
    }

    console.log(
      `Easysocial Gmail draft created for row ${applicant.rowIndex}: ${subject}${
        draftId ? ` (${draftId})` : ""
      }`
    );
    return { created: true, subject, draftId: draftId || undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { created: false, error: msg };
  }
}
