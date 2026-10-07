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
  sheetName?: string;
}): Promise<IntakeSheetRow[]> {
  const parsed = await postWebhookJson(options.webhookUrl, {
    action: "readSheet",
    spreadsheetId: options.spreadsheetId,
    unprocessedOnly: Boolean(options.unprocessedOnly),
    statusColumn: options.statusColumn || "",
    processableStatuses: options.processableStatuses || ["", "new", "retry"],
    ...(options.sheetName ? { sheetName: options.sheetName } : {}),
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

export function isUsableSheetRow(row: number): boolean {
  return Number.isInteger(row) && row >= 2;
}

export function matchAppendedSheetRow(
  rows: Array<{ rowIndex: number; values: Record<string, string> }>,
  values: Record<string, string>
): { row: number; nr: number } | null {
  const email = String(values.Email ?? "").trim().toLowerCase();
  const name = String(
    values["Full name"] || values["First names + surname"] || ""
  )
    .trim()
    .toLowerCase();
  const matches = rows.filter((row) => {
    const rowEmail = String(row.values.Email ?? "").trim().toLowerCase();
    const rowName = String(
      row.values["Full name"] || row.values["First names + surname"] || ""
    )
      .trim()
      .toLowerCase();
    return (email && rowEmail === email) || (name && rowName === name);
  });
  const hit = matches.at(-1);
  if (!hit || !isUsableSheetRow(hit.rowIndex)) return null;
  return { row: hit.rowIndex, nr: Number(hit.values.NR || 0) };
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
  const written = {
    row: Number(parsed.row || 0),
    nr: Number(parsed.nr || 0),
  };
  if (isUsableSheetRow(written.row)) return written;

  // Apps Script web apps often 302; the POST already wrote the row but the
  // confirmation GET comes back empty → parsed.row is 0.
  console.warn(
    "appendApplicant did not return a sheet row number; looking up the row we just wrote"
  );
  const rows = await readSheetRows({
    webhookUrl: options.webhookUrl,
    spreadsheetId: options.spreadsheetId,
    unprocessedOnly: true,
    statusColumn: "Status",
  });
  const recovered = matchAppendedSheetRow(rows, options.values);
  if (recovered) {
    console.log(`Recovered automation sheet row ${recovered.row} (NR ${recovered.nr})`);
    return recovered;
  }
  console.warn(
    "Could not recover the automation sheet row number; the loader will use blank-Status rows"
  );
  return written;
}
