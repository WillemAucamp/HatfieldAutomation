/**
 * Clear Status for one or more sheet rows, then run the live batch for those rows.
 *
 * Usage:
 *   npm run retry -- 18
 *   npm run retry -- 15 18
 *   npm run retry -- 12,15
 */
import { pathToFileURL } from "node:url";
import { loadColumnMapping, loadConfig } from "./config.js";
import { fetchSheetData } from "./fetchSheetData.js";
import {
  clearRowStatus,
  removeLocalOutcomesForRows,
  removeProcessedRowIds,
} from "./sheetWriter.js";

export function parseRowArgs(argv: string[]): number[] {
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

/** Programmatic retry used by the product job runner and CLI. */
export async function retryRowsMain(rows: number[]): Promise<void> {
  if (rows.length === 0) {
    throw new Error("At least one sheet row number (>= 2) is required");
  }

  const config = loadConfig();
  const mapping = loadColumnMapping(config.mappingPath);

  if (!config.sheetWebhookUrl) {
    throw new Error(
      "SHEET_WEBHOOK_URL (or SHEET_WEBHOOK_ID) is required so retry can clear Status on the sheet."
    );
  }
  if (!config.sheetCsvUrl && !config.sheetId) {
    throw new Error("SHEET_CSV_URL or SHEET_ID must be set for the client sheet.");
  }

  console.log(`Retrying row(s): ${rows.join(", ")}`);
  console.log("Fetching sheet to resolve emails...");
  const applicants = await fetchSheetData({
    csvUrl: config.sheetCsvUrl,
    mapping,
    rowFilter: rows,
    includeCompleted: true,
  });
  const byRow = new Map(applicants.map((a) => [a.rowIndex, a]));

  for (const rowIndex of rows) {
    const applicant = byRow.get(rowIndex);
    const email = applicant?.email ?? "";
    const name = applicant
      ? `${applicant.firstName} ${applicant.surname}`.trim()
      : `row ${rowIndex}`;
    console.log(`  Clearing Status for ${name} (row ${rowIndex})...`);
    await clearRowStatus(config, mapping, rowIndex, email);
  }

  const rowIds = applicants
    .filter((a) => rows.includes(a.rowIndex))
    .map((a) => a.rowId)
    .filter(Boolean);
  const removed = removeLocalOutcomesForRows(rows, rowIds);
  if (removed > 0) {
    console.log(`  Removed ${removed} local outcome record(s).`);
  }
  const clearedIds = removeProcessedRowIds(rowIds);
  if (clearedIds > 0) {
    console.log(`  Cleared ${clearedIds} ID(s) from processed-rows.json.`);
  }

  // Sheets CSV/export can lag a few seconds behind Apps Script writes.
  console.log("  Waiting for sheet Status clears to propagate...");
  await new Promise((r) => setTimeout(r, 5000));

  // Bust CSV caches so the live run does not skip on a stale Status cell.
  if (config.sheetCsvUrl) {
    const sep = config.sheetCsvUrl.includes("?") ? "&" : "?";
    process.env.SHEET_CSV_URL = `${config.sheetCsvUrl}${sep}_cb=${Date.now()}`;
  }

  process.env.ROW_FILTER = rows.join(",");
  if (!process.env.HEADLESS) process.env.HEADLESS = "true";

  console.log(`Starting live run for row(s) ${rows.join(", ")}...\n`);
  const { runBatchMain } = await import("./runBatch.js");
  await runBatchMain();
}

async function main(): Promise<void> {
  const rows = parseRowArgs(process.argv.slice(2));
  if (rows.length === 0) {
    console.error("Usage: npm run retry -- <row> [row...]");
    console.error("Example: npm run retry -- 18");
    process.exit(1);
  }
  await retryRowsMain(rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
