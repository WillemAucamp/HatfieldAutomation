import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ApplicantRecord, AppConfig, ColumnMapping } from "./types.js";

const LOCAL_REFERENCES = "application-references.json";

export interface RowOutcomeWrite {
  sheetStatus: string;
  durationSeconds: number;
  writtenToSheet: boolean;
  localPath: string;
  sheetError?: string;
}

interface LocalRecord {
  rowIndex: number;
  rowId: string;
  email: string;
  idNumber: string;
  applicantName: string;
  sheetStatus: string;
  durationSeconds: number;
  writtenToSheet: boolean;
  capturedAt: string;
}

export function saveOutcomeLocally(
  applicant: ApplicantRecord,
  sheetStatus: string,
  durationSeconds: number,
  writtenToSheet: boolean
): string {
  const path = join(process.cwd(), LOCAL_REFERENCES);
  const existing: LocalRecord[] = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as LocalRecord[])
    : [];

  const record: LocalRecord = {
    rowIndex: applicant.rowIndex,
    rowId: applicant.rowId,
    email: applicant.email,
    idNumber: applicant.idNumber,
    applicantName: `${applicant.firstName} ${applicant.surname}`.trim(),
    sheetStatus,
    durationSeconds,
    writtenToSheet,
    capturedAt: new Date().toISOString(),
  };

  const idx = existing.findIndex((r) => r.rowId === applicant.rowId);
  if (idx >= 0) existing[idx] = record;
  else existing.push(record);

  writeFileSync(path, JSON.stringify(existing, null, 2));
  return path;
}

export async function writeRowOutcomeToSheet(
  config: AppConfig,
  mapping: ColumnMapping,
  applicant: ApplicantRecord,
  sheetStatus: string,
  durationSeconds?: number
): Promise<RowOutcomeWrite> {
  let writtenToSheet = false;
  let sheetError: string | undefined;
  const statusColumn = mapping.status ?? "Status";
  const timingColumn = mapping.timing ?? "Timing";

  if (config.sheetWebhookUrl) {
    try {
      await writeViaWebhook(
        config.sheetWebhookUrl,
        applicant,
        sheetStatus,
        durationSeconds,
        statusColumn,
        timingColumn,
        mapping,
        config.sheetId
      );
      writtenToSheet = true;
    } catch (err) {
      sheetError = err instanceof Error ? err.message : String(err);
      console.error(`  [sheetWriter] Webhook write failed: ${sheetError}`);
    }
  } else if (config.googleServiceAccountFile) {
    try {
      await writeViaSheetsApi(
        config,
        applicant,
        sheetStatus,
        durationSeconds ?? 0,
        statusColumn,
        timingColumn
      );
      writtenToSheet = true;
    } catch (err) {
      sheetError = err instanceof Error ? err.message : String(err);
      console.error(`  [sheetWriter] Sheets API write failed: ${sheetError}`);
    }
  } else {
    sheetError =
      "No sheet write credentials. Set SHEET_WEBHOOK_URL (Apps Script) or GOOGLE_SERVICE_ACCOUNT_FILE.";
    console.warn(`  [sheetWriter] ${sheetError}`);
  }

  const localPath = saveOutcomeLocally(
    applicant,
    sheetStatus,
    durationSeconds ?? 0,
    writtenToSheet
  );
  console.log(
    `  [sheetWriter] ${applicant.firstName} ${applicant.surname}: ${sheetStatus} (${durationSeconds ?? "—"}s)` +
      (writtenToSheet ? " written to Google Sheet" : ` saved locally at ${localPath}`)
  );

  return { sheetStatus, durationSeconds: durationSeconds ?? 0, writtenToSheet, localPath, sheetError };
}

/** Clear Status (and optionally Timing) so a row can be retried. */
export async function clearRowStatus(
  config: AppConfig,
  mapping: ColumnMapping,
  rowIndex: number,
  email = ""
): Promise<void> {
  const webhook = config.sheetWebhookUrl;
  if (!webhook) {
    throw new Error("SHEET_WEBHOOK_URL is required to clear Status before retry");
  }
  const statusColumn = mapping.status ?? "Status";
  const timingColumn = mapping.timing ?? "Timing";
  const parsed = await postWebhookJson(webhook, {
    action: "writeStatus",
    rowIndex,
    email,
    status: "",
    timingSeconds: "",
    statusColumn,
    timingColumn,
    sourceSheetId: config.sheetId,
    emailColumn: mapping.email,
  });
  if (parsed.ok === false) {
    throw new Error(parsed.error || `Failed to clear Status on row ${rowIndex}`);
  }
}

/** Drop local outcome records so a retry is not skipped by a prior successful reference. */
export function removeLocalOutcomesForRows(rowIndexes: number[], rowIds: string[] = []): number {
  const path = join(process.cwd(), LOCAL_REFERENCES);
  if (!existsSync(path) || (rowIndexes.length === 0 && rowIds.length === 0)) return 0;
  const existing = JSON.parse(readFileSync(path, "utf-8")) as Array<{
    rowIndex?: number;
    rowId?: string;
  }>;
  const dropRows = new Set(rowIndexes);
  const dropIds = new Set(rowIds.filter(Boolean));
  const kept = existing.filter(
    (r) => !dropRows.has(Number(r.rowIndex)) && !(r.rowId && dropIds.has(r.rowId))
  );
  const removed = existing.length - kept.length;
  writeFileSync(path, JSON.stringify(kept, null, 2) + "\n");
  return removed;
}

/** Remove IDs from processed-rows.json so a forced retry is not skipped locally. */
export function removeProcessedRowIds(rowIds: string[]): number {
  const path = join(process.cwd(), "processed-rows.json");
  if (!existsSync(path) || rowIds.length === 0) return 0;
  const drop = new Set(rowIds.filter(Boolean));
  const existing = JSON.parse(readFileSync(path, "utf-8")) as string[];
  const kept = existing.filter((id) => !drop.has(id));
  const removed = existing.length - kept.length;
  writeFileSync(path, JSON.stringify(kept, null, 2) + "\n");
  return removed;
}

export async function postWebhookJson(
  url: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown> & { ok?: boolean; skipped?: boolean; updated?: boolean; error?: string; row?: number; count?: number; nr?: number; rows?: unknown[]; headers?: string[] }> {
  // Apps Script web apps 302 to googleusercontent.com. Following that
  // redirect with POST yields 405; the JSON result must be fetched with GET.
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "manual",
    body: JSON.stringify(payload),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      try {
        const followed = await fetch(location, { method: "GET", redirect: "follow" });
        const body = await followed.text().catch(() => "");
        if (followed.ok) {
          return parseWebhookBody(body);
        }
      } catch {
        // doPost already ran on the original POST; confirmation GET is best-effort.
      }
    }
    return { ok: true };
  }

  const body = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Webhook ${response.status}: ${body.slice(0, 300)}`);
  }
  return parseWebhookBody(body);
}

function parseWebhookBody(body: string): Record<string, unknown> & {
  ok?: boolean;
  skipped?: boolean;
  updated?: boolean;
  error?: string;
  row?: number;
  count?: number;
  nr?: number;
} {
  if (!body.trim()) {
    return { ok: true };
  }
  try {
    return JSON.parse(body) as Record<string, unknown> & {
      ok?: boolean;
      skipped?: boolean;
      updated?: boolean;
      error?: string;
      row?: number;
      count?: number;
      nr?: number;
    };
  } catch {
    if (/<!doctype html/i.test(body) || /authorization/i.test(body)) {
      throw new Error(
        `Webhook returned HTML instead of JSON. Redeploy the web app with access set to Anyone. Body: ${body.slice(0, 200)}`
      );
    }
    throw new Error(`Webhook returned non-JSON: ${body.slice(0, 300)}`);
  }
}

/**
 * Overwrite Number on an existing Name row. Uses the already-deployed writeStatus
 * action (it can target any spreadsheet + column) so this works without a redeploy.
 */
async function updateLoadedNumberByName(
  webhook: string,
  config: AppConfig,
  name: string,
  number: string
): Promise<boolean> {
  const parsed = await postWebhookJson(webhook, {
    action: "writeStatus",
    sourceSheetId: config.loadedSheetId,
    email: name,
    emailColumn: config.loadedNameColumn,
    status: number,
    statusColumn: config.loadedNumberColumn,
    timingColumn: config.loadedNumberColumn,
  });
  if (parsed.ok === false) {
    if (/could not match/i.test(parsed.error || "")) return false;
    throw new Error(parsed.error || "Loaded-clients name update failed");
  }
  return Boolean(parsed.row);
}

async function writeViaWebhook(
  url: string,
  applicant: ApplicantRecord,
  sheetStatus: string,
  durationSeconds: number | undefined,
  statusColumn: string,
  timingColumn: string,
  mapping: ColumnMapping,
  sourceSheetId: string
): Promise<void> {
  const payload: Record<string, unknown> = {
    action: "writeStatus",
    rowIndex: applicant.rowIndex,
    email: applicant.email,
    idNumber: applicant.idNumber,
    status: sheetStatus,
    referenceNumber: sheetStatus,
    statusColumn,
    referenceColumn: statusColumn,
    timingColumn,
    sourceSheetId,
    idColumn: mapping.idNumber,
    emailColumn: mapping.email,
  };
  if (durationSeconds !== undefined && durationSeconds !== null) {
    payload.timingSeconds = durationSeconds;
  }

  const parsed = await postWebhookJson(url, payload);
  if (parsed.ok === false) {
    throw new Error(parsed.error || "Webhook writeStatus returned ok=false");
  }
}

async function writeViaSheetsApi(
  config: AppConfig,
  applicant: ApplicantRecord,
  sheetStatus: string,
  durationSeconds: number,
  statusColumn: string,
  timingColumn: string
): Promise<void> {
  const { google } = await import("googleapis");
  const keyFile = resolve(config.googleServiceAccountFile ?? "");
  if (!existsSync(keyFile)) {
    throw new Error(`Service account file not found: ${keyFile}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = config.sheetId;
  if (!spreadsheetId) {
    throw new Error("SHEET_ID is not set");
  }

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitle = meta.data.sheets?.[0]?.properties?.title;
  if (!sheetTitle) throw new Error("Could not read the first worksheet title");

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!1:1`,
  });
  const headers = [...(headerRes.data.values?.[0] ?? [])];

  const statusIndex = await ensureHeader(sheets, spreadsheetId, sheetTitle, headers, statusColumn);
  const timingIndex = await ensureHeader(sheets, spreadsheetId, sheetTitle, headers, timingColumn);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        {
          range: `'${sheetTitle}'!${columnIndexToLetter(statusIndex)}${applicant.rowIndex}`,
          values: [[sheetStatus]],
        },
        {
          range: `'${sheetTitle}'!${columnIndexToLetter(timingIndex)}${applicant.rowIndex}`,
          values: [[durationSeconds]],
        },
      ],
    },
  });
}

async function ensureHeader(
  sheets: any,
  spreadsheetId: string,
  sheetTitle: string,
  headers: string[],
  columnName: string
): Promise<number> {
  let colIndex = headers.findIndex((h) => String(h).trim() === columnName);
  if (colIndex >= 0) return colIndex;

  colIndex = headers.length;
  headers.push(columnName);
  const colLetter = columnIndexToLetter(colIndex);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!${colLetter}1`,
    valueInputOption: "RAW",
    requestBody: { values: [[columnName]] },
  });
  return colIndex;
}

function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letter = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

export interface LoadedClientWrite {
  written: boolean;
  skipped?: boolean;
  updated?: boolean;
  error?: string;
}

export interface RenumberRowsResult {
  ok: boolean;
  count?: number;
  error?: string;
}

/** Fill column A (NR) with 1, 2, 3… — row 2 = 1, row 1 = header. */
export async function renumberSheetRows(
  config: AppConfig,
  mapping: ColumnMapping
): Promise<RenumberRowsResult> {
  const nrColumn = mapping.nr ?? "NR";

  if (config.sheetWebhookUrl) {
    try {
      const parsed = await postWebhookJson(config.sheetWebhookUrl, {
        action: "renumberRows",
        sourceSheetId: config.sheetId,
        nrColumn,
      });
      if (parsed.ok === false) {
        const error = parsed.error || "Webhook renumberRows returned ok=false";
        console.warn(`  [sheetWriter] Renumber NR failed: ${error}`);
        return { ok: false, error };
      }
      const count = typeof parsed.count === "number" ? parsed.count : undefined;
      console.log(
        `  [sheetWriter] NR column renumbered${count != null ? ` (${count} row(s), 1 on row 2)` : ""}`
      );
      return { ok: true, count };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`  [sheetWriter] Renumber NR failed: ${error}`);
      return { ok: false, error };
    }
  }

  if (config.googleServiceAccountFile) {
    try {
      const count = await renumberViaSheetsApi(config, nrColumn);
      console.log(`  [sheetWriter] NR column renumbered (${count} row(s), 1 on row 2)`);
      return { ok: true, count };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`  [sheetWriter] Renumber NR failed: ${error}`);
      return { ok: false, error };
    }
  }

  const error =
    "No sheet write credentials. Set SHEET_WEBHOOK_URL (Apps Script) or GOOGLE_SERVICE_ACCOUNT_FILE.";
  console.warn(`  [sheetWriter] ${error}`);
  return { ok: false, error };
}

async function renumberViaSheetsApi(config: AppConfig, nrColumn: string): Promise<number> {
  const { google } = await import("googleapis");
  const keyFile = resolve(config.googleServiceAccountFile ?? "");
  if (!existsSync(keyFile)) {
    throw new Error(`Service account file not found: ${keyFile}`);
  }
  const spreadsheetId = config.sheetId;
  if (!spreadsheetId) {
    throw new Error("SHEET_ID is not set");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitle = meta.data.sheets?.[0]?.properties?.title;
  if (!sheetTitle) throw new Error("Could not read the first worksheet title");

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!1:1`,
  });
  const headers = [...(headerRes.data.values?.[0] ?? [])];
  if (headers[0]?.trim() !== nrColumn) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetTitle}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [[nrColumn]] },
    });
  }

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A:Z`,
  });
  const lastRow = (dataRes.data.values ?? []).length;
  if (lastRow < 2) return 0;

  const count = lastRow - 1;
  const values = Array.from({ length: count }, (_, i) => [i + 1]);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!A2:A${lastRow}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  return count;
}

/** Upsert Name + cellphone on the loaded-clients spreadsheet after a successful submit. */
export async function appendLoadedClient(
  config: AppConfig,
  name: string,
  number: string
): Promise<LoadedClientWrite> {
  const webhook = config.loadedSheetWebhookUrl || config.sheetWebhookUrl;
  if (webhook) {
    try {
      const updated = await updateLoadedNumberByName(webhook, config, name, number);
      if (updated) {
        console.log(`  [sheetWriter] Loaded-clients sheet: ${name} → ${number} (updated)`);
        return { written: true, updated: true };
      }

      const parsed = await postWebhookJson(webhook, {
        action: "appendLoaded",
        name,
        number,
        mobile: number,
        loadedSheetId: config.loadedSheetId,
        nameColumn: config.loadedNameColumn,
        numberColumn: config.loadedNumberColumn,
      });
      if (parsed.ok === false) {
        throw new Error(parsed.error || "Webhook appendLoaded returned ok=false");
      }
      const skipped = Boolean(parsed.skipped);
      const wasUpdate = Boolean(parsed.updated);
      console.log(
        `  [sheetWriter] Loaded-clients sheet: ${name} → ${number}` +
          (skipped ? " (already present)" : wasUpdate ? " (updated)" : "")
      );
      return { written: true, skipped, updated: wasUpdate };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`  [sheetWriter] Loaded-clients webhook failed: ${error}`);
      return { written: false, error };
    }
  }

  if (config.googleServiceAccountFile) {
    try {
      await appendLoadedViaSheetsApi(config, name, number);
      console.log(`  [sheetWriter] Loaded-clients sheet: ${name} → ${number}`);
      return { written: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`  [sheetWriter] Loaded-clients Sheets API failed: ${error}`);
      return { written: false, error };
    }
  }

  const error =
    "No sheet write credentials. Set SHEET_WEBHOOK_URL (Apps Script on either sheet) or GOOGLE_SERVICE_ACCOUNT_FILE.";
  console.warn(`  [sheetWriter] ${error}`);
  return { written: false, error };
}

async function appendLoadedViaSheetsApi(
  config: AppConfig,
  name: string,
  number: string
): Promise<void> {
  const { google } = await import("googleapis");
  const keyFile = resolve(config.googleServiceAccountFile ?? "");
  if (!existsSync(keyFile)) {
    throw new Error(`Service account file not found: ${keyFile}`);
  }
  const spreadsheetId = config.loadedSheetId;
  if (!spreadsheetId) throw new Error("LOADED_SHEET_ID is not set");

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitle = meta.data.sheets?.[0]?.properties?.title;
  if (!sheetTitle) throw new Error("Could not read the loaded-clients worksheet title");

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!1:1`,
  });
  const headers = [...(headerRes.data.values?.[0] ?? [])];
  const nameIndex = await ensureHeader(
    sheets,
    spreadsheetId,
    sheetTitle,
    headers,
    config.loadedNameColumn
  );
  const numberIndex = await ensureHeader(
    sheets,
    spreadsheetId,
    sheetTitle,
    headers,
    config.loadedNumberColumn
  );

  const nameCol = columnIndexToLetter(nameIndex);
  const numberCol = columnIndexToLetter(numberIndex);
  const [nameRes, numberRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTitle}'!${nameCol}2:${nameCol}`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTitle}'!${numberCol}2:${numberCol}`,
    }),
  ]);
  const names = nameRes.data.values ?? [];
  const numbers = numberRes.data.values ?? [];
  const nameKey = name.trim().toLowerCase();
  const updates: { range: string; values: string[][] }[] = [];
  for (let i = 0; i < names.length; i++) {
    if (String(names[i]?.[0] ?? "").trim().toLowerCase() !== nameKey) continue;
    updates.push({
      range: `'${sheetTitle}'!${numberCol}${i + 2}`,
      values: [[number]],
    });
  }
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates },
    });
    return;
  }

  const already = numbers.some((row) => String(row[0] ?? "").trim() === number);
  if (already) return;

  const rowRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A:A`,
  });
  const nextRow = Math.max((rowRes.data.values ?? []).length, 1) + 1;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        {
          range: `'${sheetTitle}'!${columnIndexToLetter(nameIndex)}${nextRow}`,
          values: [[name]],
        },
        {
          range: `'${sheetTitle}'!${columnIndexToLetter(numberIndex)}${nextRow}`,
          values: [[number]],
        },
      ],
    },
  });
}
