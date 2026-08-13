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

async function postWebhookJson(
  url: string,
  payload: Record<string, unknown>
): Promise<{ ok?: boolean; skipped?: boolean; error?: string }> {
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

function parseWebhookBody(body: string): { ok?: boolean; skipped?: boolean; error?: string } {
  if (!body.trim()) {
    return { ok: true };
  }
  try {
    return JSON.parse(body) as { ok?: boolean; skipped?: boolean; error?: string };
  } catch {
    if (/<!doctype html/i.test(body) || /authorization/i.test(body)) {
      throw new Error(
        `Webhook returned HTML instead of JSON. Redeploy the web app with access set to Anyone. Body: ${body.slice(0, 200)}`
      );
    }
    throw new Error(`Webhook returned non-JSON: ${body.slice(0, 300)}`);
  }
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
  error?: string;
}

/** Append Name + Number to the loaded-clients spreadsheet after a successful submit. */
export async function appendLoadedClient(
  config: AppConfig,
  name: string,
  number: string
): Promise<LoadedClientWrite> {
  const webhook = config.loadedSheetWebhookUrl || config.sheetWebhookUrl;
  if (webhook) {
    try {
      const parsed = await postWebhookJson(webhook, {
        action: "appendLoaded",
        name,
        number,
        loadedSheetId: config.loadedSheetId,
        nameColumn: config.loadedNameColumn,
        numberColumn: config.loadedNumberColumn,
      });
      if (parsed.ok === false) {
        throw new Error(parsed.error || "Webhook appendLoaded returned ok=false");
      }
      console.log(
        `  [sheetWriter] Loaded-clients sheet: ${name} → ${number}` +
          (parsed.skipped ? " (already present)" : "")
      );
      return { written: true, skipped: parsed.skipped };
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

  const numberCol = columnIndexToLetter(numberIndex);
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!${numberCol}2:${numberCol}`,
  });
  const already = (existing.data.values ?? []).some(
    (row) => String(row[0] ?? "").trim() === number
  );
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
