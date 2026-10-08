import { postWebhookJson } from "../sheetWriter.js";

export interface IntakeSheetRow {
  rowIndex: number;
  status: string;
  values: Record<string, string>;
}

/**
 * Melrose wrote these Enrichment Status values. Anything else in that column
 * (Form answers, operator notes) must not block ingest.
 */
export function isTerminalIntakeStatus(status: string | undefined | null): boolean {
  const s = String(status ?? "").trim();
  if (!s) return false;
  return /^(enriched\b|skipped_|processing\b|error\b)/i.test(s);
}

const DEFAULT_INTAKE_SHEET_NAME = "Form Responses 1";

/** Empty scan column: Apps Script ensureColumn_ fills it blank so every row is returned. */
const INTAKE_SCAN_COLUMN = "__melrose_row_scan__";

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
  sheetName?: string;
}): Promise<IntakeSheetRow[]> {
  const sheetName = options.sheetName || DEFAULT_INTAKE_SHEET_NAME;

  // Full-sheet scan (not Enrichment Status allowlist). Form answers that landed
  // in Enrichment Status used to make scanned=0 even for brand-new submissions.
  const scanned = await readSheetRows({
    webhookUrl: options.webhookUrl,
    spreadsheetId: options.spreadsheetId,
    sheetName,
    unprocessedOnly: true,
    statusColumn: INTAKE_SCAN_COLUMN,
    processableStatuses: [""],
  });

  const pending: IntakeSheetRow[] = [];
  const leaked: IntakeSheetRow[] = [];
  for (const row of scanned) {
    const enrich = String(row.values[options.statusColumn] ?? "").trim();
    if (isTerminalIntakeStatus(enrich)) continue;
    pending.push({
      ...row,
      status: enrich.toLowerCase(),
    });
    if (enrich && !/^(new|retry)$/i.test(enrich)) {
      leaked.push(row);
    }
  }

  // Clear leaked Form text so older GHA/main builds that still use the allowlist
  // can see these rows on the next click.
  if (leaked.length > 0) {
    const updates = leaked.map((row) => ({
      row: row.rowIndex,
      column: options.statusColumn,
      value: "",
    }));
    console.warn(
      `Clearing ${updates.length} non-pipeline Enrichment Status value(s) that were blocking ingest`
    );
    const parsed = await postWebhookJson(options.webhookUrl, {
      action: "updateSheet",
      spreadsheetId: options.spreadsheetId,
      updates,
    });
    if (parsed.ok === false) {
      console.warn(`Could not clear leaked statuses: ${parsed.error}`);
    } else {
      for (const row of leaked) {
        row.values[options.statusColumn] = "";
      }
    }
  }

  return pending;
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
