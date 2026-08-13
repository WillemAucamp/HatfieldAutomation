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
  durationSeconds: number
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
        mapping
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
        durationSeconds,
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

  const localPath = saveOutcomeLocally(applicant, sheetStatus, durationSeconds, writtenToSheet);
  console.log(
    `  [sheetWriter] ${applicant.firstName} ${applicant.surname}: ${sheetStatus} (${durationSeconds}s)` +
      (writtenToSheet ? " written to Google Sheet" : ` saved locally at ${localPath}`)
  );

  return { sheetStatus, durationSeconds, writtenToSheet, localPath, sheetError };
}

async function writeViaWebhook(
  url: string,
  applicant: ApplicantRecord,
  sheetStatus: string,
  durationSeconds: number,
  statusColumn: string,
  timingColumn: string,
  mapping: ColumnMapping
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "follow",
    body: JSON.stringify({
      rowIndex: applicant.rowIndex,
      email: applicant.email,
      idNumber: applicant.idNumber,
      status: sheetStatus,
      referenceNumber: sheetStatus,
      timingSeconds: durationSeconds,
      statusColumn,
      referenceColumn: statusColumn,
      timingColumn,
      idColumn: mapping.idNumber,
      emailColumn: mapping.email,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Webhook ${response.status}: ${body.slice(0, 300)}`);
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
