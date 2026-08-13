import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ApplicantRecord, AppConfig, ColumnMapping } from "./types.js";

const LOCAL_REFERENCES = "application-references.json";

export interface ReferenceWriteResult {
  referenceNumber: string;
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
  referenceNumber: string;
  writtenToSheet: boolean;
  capturedAt: string;
}

export function saveReferenceLocally(
  applicant: ApplicantRecord,
  referenceNumber: string,
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
    referenceNumber,
    writtenToSheet,
    capturedAt: new Date().toISOString(),
  };

  const idx = existing.findIndex((r) => r.rowId === applicant.rowId);
  if (idx >= 0) existing[idx] = record;
  else existing.push(record);

  writeFileSync(path, JSON.stringify(existing, null, 2));
  return path;
}

export async function writeReferenceToSheet(
  config: AppConfig,
  mapping: ColumnMapping,
  applicant: ApplicantRecord,
  referenceNumber: string
): Promise<ReferenceWriteResult> {
  let writtenToSheet = false;
  let sheetError: string | undefined;

  if (config.sheetWebhookUrl) {
    try {
      await writeViaWebhook(config.sheetWebhookUrl, applicant, referenceNumber, mapping);
      writtenToSheet = true;
    } catch (err) {
      sheetError = err instanceof Error ? err.message : String(err);
      console.error(`  [sheetWriter] Webhook write failed: ${sheetError}`);
    }
  } else if (config.googleServiceAccountFile) {
    try {
      await writeViaSheetsApi(config, mapping, applicant, referenceNumber);
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

  const localPath = saveReferenceLocally(applicant, referenceNumber, writtenToSheet);
  console.log(
    `  [sheetWriter] ${applicant.firstName} ${applicant.surname}: ${referenceNumber}` +
      (writtenToSheet ? " written to Google Sheet" : ` saved locally at ${localPath}`)
  );

  return { referenceNumber, writtenToSheet, localPath, sheetError };
}

async function writeViaWebhook(
  url: string,
  applicant: ApplicantRecord,
  referenceNumber: string,
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
      referenceNumber,
      referenceColumn: mapping.referenceNumber ?? "Reference Number",
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
  mapping: ColumnMapping,
  applicant: ApplicantRecord,
  referenceNumber: string
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
  const headers = headerRes.data.values?.[0] ?? [];
  const columnName = mapping.referenceNumber ?? "Reference Number";
  let colIndex = headers.findIndex((h) => String(h).trim() === columnName);

  if (colIndex < 0) {
    colIndex = headers.length;
    const colLetter = columnIndexToLetter(colIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetTitle}'!${colLetter}1`,
      valueInputOption: "RAW",
      requestBody: { values: [[columnName]] },
    });
  }

  const colLetter = columnIndexToLetter(colIndex);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!${colLetter}${applicant.rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[referenceNumber]] },
  });
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
