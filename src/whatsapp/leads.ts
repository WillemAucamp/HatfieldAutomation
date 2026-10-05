import type { AppConfig } from "../types.js";
import { postWebhookJson } from "../sheetWriter.js";
import { sendWhatsAppMessage, type WhatsAppSendResult } from "./client.js";
import { isNotifiableLeadStatus, normalizeSaWhatsappPhone } from "./phone.js";

export interface LeadRow {
  rowIndex: number;
  name: string;
  number: string;
  status: string;
  whatsappSent: string;
  values: Record<string, string>;
}

export interface NotifyLeadsSummary {
  scanned: number;
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
  results: Array<{
    rowIndex: number;
    name: string;
    status: string;
    result: WhatsAppSendResult;
  }>;
}

function cell(values: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = values[key];
    if (direct != null && String(direct).trim()) return String(direct).trim();
    const found = Object.entries(values).find(
      ([header]) => header.trim().toLowerCase() === key.trim().toLowerCase()
    );
    if (found && String(found[1]).trim()) return String(found[1]).trim();
  }
  return "";
}

export function columnIndexToLetter(index: number): string {
  let n = Number(index) || 0;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function isWhatsAppAlreadySent(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return false;
  return v === "yes" || v === "y" || v === "true" || v === "1" || v.startsWith("sent");
}

export function leadNeedsWhatsApp(row: Pick<LeadRow, "status" | "whatsappSent" | "number">): boolean {
  if (!isNotifiableLeadStatus(row.status)) return false;
  if (isWhatsAppAlreadySent(row.whatsappSent)) return false;
  return Boolean(normalizeSaWhatsappPhone(row.number));
}

function headerIndex(headers: string[], name: string): number {
  const target = name.trim().toLowerCase();
  return headers.findIndex((h) => String(h || "").trim().toLowerCase() === target);
}

export async function ensureWhatsAppSentColumn(config: AppConfig): Promise<void> {
  const webhook = config.sheetWebhookUrl || config.loadedSheetWebhookUrl;
  if (!webhook) throw new Error("SHEET_WEBHOOK_URL is required");

  const preview = await postWebhookJson(webhook, {
    action: "readSheet",
    spreadsheetId: config.leadsSpreadsheetId,
    sheetGid: config.leadsSheetGid,
    unprocessedOnly: false,
  });
  if (preview.ok === false) {
    throw new Error(String(preview.error || "readSheet failed while ensuring WhatsApp column"));
  }

  const headers = Array.isArray(preview.headers)
    ? preview.headers.map((h) => String(h || ""))
    : [];
  const existing = headerIndex(headers, config.leadsWhatsappSentColumn);
  if (existing >= 0) {
    const parsed = await postWebhookJson(webhook, {
      action: "updateSheet",
      spreadsheetId: config.leadsSpreadsheetId,
      sheetGid: config.leadsSheetGid,
      dataValidation: {
        column: config.leadsWhatsappSentColumn,
        options: ["Yes", "No"],
      },
    });
    if (parsed.ok === false) {
      throw new Error(String(parsed.error || "Failed to refresh WhatsApp sent validation"));
    }
    return;
  }

  const statusIdx = headerIndex(headers, config.leadsStatusColumn);
  const afterLetter =
    statusIdx >= 0 ? columnIndexToLetter(statusIdx + 1) : columnIndexToLetter(Math.max(headers.length, 1));

  const parsed = await postWebhookJson(webhook, {
    action: "updateSheet",
    spreadsheetId: config.leadsSpreadsheetId,
    sheetGid: config.leadsSheetGid,
    insertColumn: {
      after: afterLetter,
      header: config.leadsWhatsappSentColumn,
      validation: ["Yes", "No"],
    },
  });
  if (parsed.ok === false) {
    throw new Error(String(parsed.error || "Failed to ensure WhatsApp sent column"));
  }
}

export async function readLeadRows(config: AppConfig): Promise<LeadRow[]> {
  const webhook = config.sheetWebhookUrl || config.loadedSheetWebhookUrl;
  if (!webhook) throw new Error("SHEET_WEBHOOK_URL is required");

  const parsed = await postWebhookJson(webhook, {
    action: "readSheet",
    spreadsheetId: config.leadsSpreadsheetId,
    sheetGid: config.leadsSheetGid,
    unprocessedOnly: false,
  });
  if (parsed.ok === false) {
    throw new Error(String(parsed.error || "readSheet failed for leads"));
  }

  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  return rows.map((row) => {
    const rec = row as { rowIndex?: number; values?: Record<string, string> };
    const values = rec.values ?? {};
    return {
      rowIndex: Number(rec.rowIndex),
      name: cell(values, config.leadsNameColumn, "Name", "Full name"),
      number: cell(values, config.leadsNumberColumn, "Number", "Mobile", "Phone", "Whatsapp"),
      status: cell(values, config.leadsStatusColumn, "Status"),
      whatsappSent: cell(values, config.leadsWhatsappSentColumn, "WhatsApp sent", "Whatsapp sent"),
      values,
    };
  });
}

export async function markWhatsAppSent(
  config: AppConfig,
  rowIndex: number,
  value = "Yes"
): Promise<void> {
  const webhook = config.sheetWebhookUrl || config.loadedSheetWebhookUrl;
  if (!webhook) throw new Error("SHEET_WEBHOOK_URL is required");

  const parsed = await postWebhookJson(webhook, {
    action: "updateSheet",
    spreadsheetId: config.leadsSpreadsheetId,
    sheetGid: config.leadsSheetGid,
    updates: [
      {
        row: rowIndex,
        column: config.leadsWhatsappSentColumn,
        value,
      },
    ],
  });
  if (parsed.ok === false) {
    throw new Error(String(parsed.error || `Failed to mark WhatsApp sent on row ${rowIndex}`));
  }
}

export async function notifyPendingLeads(
  config: AppConfig,
  options: { rowFilter?: number[]; ensureColumn?: boolean; dryRun?: boolean } = {}
): Promise<NotifyLeadsSummary> {
  if (options.ensureColumn !== false) {
    await ensureWhatsAppSentColumn(config);
  }

  const rows = await readLeadRows(config);
  const filter = new Set(options.rowFilter ?? []);
  const candidates = rows.filter((row) => {
    if (filter.size && !filter.has(row.rowIndex)) return false;
    return leadNeedsWhatsApp(row);
  });

  const summary: NotifyLeadsSummary = {
    scanned: rows.length,
    pending: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  for (const row of candidates) {
    if (options.dryRun || config.dryRun) {
      summary.skipped++;
      summary.results.push({
        rowIndex: row.rowIndex,
        name: row.name,
        status: row.status,
        result: {
          ok: true,
          skipped: true,
          reason: "dry-run",
          phoneE164: normalizeSaWhatsappPhone(row.number),
          template: row.status.trim().toLowerCase() === "approved" ? config.whatsapp.approveTemplate : config.whatsapp.declineTemplate,
        },
      });
      continue;
    }

    const result = await sendWhatsAppMessage(config.whatsapp, {
      phone: row.number,
      status: row.status,
      name: row.name,
      rowIndex: row.rowIndex,
    });

    summary.results.push({
      rowIndex: row.rowIndex,
      name: row.name,
      status: row.status,
      result,
    });

    if (result.ok && !result.skipped) {
      await markWhatsAppSent(config, row.rowIndex, "Yes");
      summary.sent++;
    } else if (result.skipped) {
      summary.skipped++;
    } else {
      summary.failed++;
    }
  }

  return summary;
}
