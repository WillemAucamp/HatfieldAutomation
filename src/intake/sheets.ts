import { postWebhookJson } from "../sheetWriter.js";

export interface IntakeSheetRow {
  rowIndex: number;
  status: string;
  values: Record<string, string>;
}

export async function readSheetRows(options: {
  webhookUrl: string;
  spreadsheetId: string;
  unprocessedOnly?: boolean;
  statusColumn?: string;
  processableStatuses?: string[];
}): Promise<IntakeSheetRow[]> {
  const parsed = await postWebhookJson(options.webhookUrl, {
    action: "readSheet",
    spreadsheetId: options.spreadsheetId,
    unprocessedOnly: Boolean(options.unprocessedOnly),
    statusColumn: options.statusColumn || "",
    processableStatuses: options.processableStatuses || ["", "new", "retry"],
  });
  if (parsed.ok === false) {
    throw new Error(String(parsed.error || "readSheet failed"));
  }
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  return rows.map((row) => {
    const rec = row as { rowIndex?: number; status?: string; values?: Record<string, string> };
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(rec.values ?? {})) {
      values[key] = value == null ? "" : String(value);
    }
    return {
      rowIndex: Number(rec.rowIndex),
      status: String(rec.status ?? ""),
      values,
    };
  });
}

export async function readUnprocessedIntake(options: {
  webhookUrl: string;
  spreadsheetId: string;
  statusColumn: string;
}): Promise<IntakeSheetRow[]> {
  return readSheetRows({
    webhookUrl: options.webhookUrl,
    spreadsheetId: options.spreadsheetId,
    unprocessedOnly: true,
    statusColumn: options.statusColumn,
    processableStatuses: ["", "new", "retry"],
  });
}

export async function markIntakeStatus(options: {
  webhookUrl: string;
  spreadsheetId: string;
  rowIndex: number;
  statusColumn: string;
  status: string;
}): Promise<void> {
  const parsed = await postWebhookJson(options.webhookUrl, {
    action: "updateSheet",
    spreadsheetId: options.spreadsheetId,
    updates: [
      {
        row: options.rowIndex,
        column: options.statusColumn,
        value: options.status,
      },
    ],
  });
  if (parsed.ok === false) {
    throw new Error(String(parsed.error || "Failed to mark intake status"));
  }
}

export async function appendAutomationRow(options: {
  webhookUrl: string;
  spreadsheetId: string;
  values: Record<string, string>;
}): Promise<{ row: number; nr: number }> {
  const parsed = await postWebhookJson(options.webhookUrl, {
    action: "appendApplicant",
    spreadsheetId: options.spreadsheetId,
    values: options.values,
  });
  if (parsed.ok === false) {
    throw new Error(String(parsed.error || "appendApplicant failed"));
  }
  return {
    row: Number(parsed.row || 0),
    nr: Number(parsed.nr || 0),
  };
}
