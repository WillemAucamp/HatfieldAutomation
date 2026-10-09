/**
 * Patch failed rows from this load wave and clear Status for retry.
 *
 *   npx tsx src/prepareRetryLoad.ts
 *   npx tsx src/prepareRetryLoad.ts 286 287 289
 */
import { loadColumnMapping, loadConfig } from "./config.js";
import { cell, firstFilled } from "./intake/headers.js";
import { loadIntakeMapping } from "./intake/mapping.js";
import { buildOutputValues } from "./intake/row.js";
import { readSheetRows } from "./intake/sheets.js";
import {
  clearRowStatus,
  postWebhookJson,
  removeLocalOutcomesForRows,
  removeProcessedRowIds,
} from "./sheetWriter.js";
import { isMissingValue, parseDurationToMmDdYyyy } from "./transforms.js";

const DEFAULT_RETRY_ROWS = [
  286, 287, 289, 290, 291, 292, 294, 295, 299, 301, 302, 304, 307, 308, 311, 312, 313, 314, 315,
  316, 317, 318, 319,
];

function norm(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseRowArgs(argv: string[]): number[] {
  const rows: number[] = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) continue;
    for (const part of arg.split(",")) {
      const n = parseInt(part.trim(), 10);
      if (!Number.isNaN(n) && n >= 2) rows.push(n);
    }
  }
  return [...new Set(rows)].sort((a, b) => a - b);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const mapping = loadIntakeMapping(config.intakeMappingPath);
  const columnMapping = loadColumnMapping(config.mappingPath);
  if (!config.sheetWebhookUrl) throw new Error("SHEET_WEBHOOK_URL required");

  const requested = parseRowArgs(process.argv.slice(2));
  const targetRows = requested.length ? requested : DEFAULT_RETRY_ROWS;

  const parsedAuto = await postWebhookJson(config.sheetWebhookUrl, {
    action: "readSheet",
    spreadsheetId: config.sheetId,
    gid: 0,
    unprocessedOnly: false,
  });
  if (parsedAuto.ok === false) {
    throw new Error(String(parsedAuto.error || "readSheet automation failed"));
  }
  const autoByRow = new Map<number, Record<string, string>>();
  for (const row of Array.isArray(parsedAuto.rows) ? parsedAuto.rows : []) {
    const rec = row as { rowIndex?: number; values?: Record<string, string> };
    const rowIndex = Number(rec.rowIndex);
    if (!Number.isFinite(rowIndex)) continue;
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(rec.values ?? {})) {
      values[key] = value == null ? "" : String(value);
    }
    autoByRow.set(rowIndex, values);
  }

  const intakeRows = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    sheetGid: config.intakeSheetGid,
    sheetName: config.intakeSheetName,
    unprocessedOnly: false,
  });

  const updates: Array<{ row: number; column: string; value: string }> = [];
  const retryRows: number[] = [];

  for (const rowIndex of targetRows) {
    const values = autoByRow.get(rowIndex);
    if (!values) {
      console.warn(`Row ${rowIndex} not found on automation sheet`);
      continue;
    }
    const status = String(values.Status || "").trim();
    if (/ZAHTVW/i.test(status)) {
      console.log(`Skip row ${rowIndex}: already loaded (${status})`);
      continue;
    }
    retryRows.push(rowIndex);

    updates.push({
      row: rowIndex,
      column: "Max price range",
      value: mapping.standing_defaults?.["Max price range"] || "350000",
    });
    if (isMissingValue(values["Next of kin relationship"])) {
      updates.push({ row: rowIndex, column: "Next of kin relationship", value: "Friend" });
    }
    if (isMissingValue(values["Transport cost"])) {
      updates.push({ row: rowIndex, column: "Transport cost", value: "0" });
    }

    const email = norm(values.Email || "");
    const id = String(values["ID number"] || "").replace(/\D/g, "");
    const intake = intakeRows.find((row) => {
      const iEmail = norm(cell(row.values, mapping.intake_headers.email));
      const iId = cell(row.values, mapping.intake_headers.id_number).replace(/\D/g, "");
      return (email && iEmail && email === iEmail) || (id && iId && id === iId);
    });
    if (!intake) continue;

    const rebuilt = buildOutputValues(mapping, {}, intake.values);
    for (const col of [
      "Address line",
      "Postal code",
      "Next of kin name + Surname",
      "Year start living at address (MM DD YYYY format ONLY)",
      "Year they started working there (calculate from years provided)",
      "Marital status",
    ] as const) {
      if (!isMissingValue(rebuilt[col])) {
        updates.push({ row: rowIndex, column: col, value: rebuilt[col]! });
      }
    }

    const spouseName = firstFilled(intake.values, [
      mapping.intake_headers.spouse_name,
      "Spouse Name + Surname",
    ]);
    const spousePhone = firstFilled(intake.values, [
      mapping.intake_headers.spouse_number,
      "Spouse number",
    ]);
    if (spouseName) {
      updates.push({ row: rowIndex, column: "Spouse Name + Surname", value: spouseName });
    }
    if (spousePhone) {
      updates.push({ row: rowIndex, column: "Spouse number", value: spousePhone });
    }

    const lived = firstFilled(intake.values, [mapping.intake_headers.years_at_address]);
    const livedDate = parseDurationToMmDdYyyy(lived);
    if (livedDate) {
      updates.push({
        row: rowIndex,
        column: "Year start living at address (MM DD YYYY format ONLY)",
        value: livedDate,
      });
    }
  }

  console.log(`Retry rows: ${retryRows.join(",") || "(none)"}`);
  console.log(`Cell updates: ${updates.length}`);

  for (let i = 0; i < updates.length; i += 40) {
    const chunk = updates.slice(i, i + 40);
    const parsed = await postWebhookJson(config.sheetWebhookUrl, {
      action: "updateSheet",
      spreadsheetId: config.sheetId,
      updates: chunk,
    });
    if (parsed.ok === false) throw new Error(String(parsed.error || "updateSheet failed"));
    console.log(`Wrote updates ${i + 1}-${i + chunk.length}`);
  }

  for (const rowIndex of retryRows) {
    const email = autoByRow.get(rowIndex)?.Email || "";
    process.stdout.write(`Clearing Status row ${rowIndex}… `);
    await clearRowStatus(config, columnMapping, rowIndex, email);
    console.log("ok");
  }

  removeLocalOutcomesForRows(retryRows);
  removeProcessedRowIds(
    retryRows.map((r) => String(autoByRow.get(r)?.["ID number"] || "")).filter(Boolean)
  );

  console.log(`ROW_FILTER=${retryRows.join(",")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
