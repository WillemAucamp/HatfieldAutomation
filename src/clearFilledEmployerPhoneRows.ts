/**
 * Clear Status on rows that already got employer phones filled.
 * Retries sheet reads because Apps Script occasionally returns 0 rows.
 *
 *   npx tsx src/clearFilledEmployerPhoneRows.ts
 */
import { loadColumnMapping, loadConfig } from "./config.js";
import {
  clearRowStatus,
  postWebhookJson,
  removeLocalOutcomesForRows,
  removeProcessedRowIds,
} from "./sheetWriter.js";

const ROWS = [
  97, 290, 291, 292, 299, 301, 302, 303, 306, 308, 310, 311, 312, 316, 317, 318,
];

async function readAuto(
  webhookUrl: string,
  spreadsheetId: string
): Promise<Map<number, Record<string, string>>> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const parsed = await postWebhookJson(webhookUrl, {
      action: "readSheet",
      spreadsheetId,
      gid: 0,
      unprocessedOnly: false,
    });
    const byRow = new Map<number, Record<string, string>>();
    for (const row of Array.isArray(parsed.rows) ? parsed.rows : []) {
      const rec = row as { rowIndex?: number; values?: Record<string, string> };
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec.values ?? {})) {
        values[k] = v == null ? "" : String(v);
      }
      byRow.set(Number(rec.rowIndex), values);
    }
    console.log(`read attempt ${attempt}: ${byRow.size} rows`);
    if (byRow.size > 0) return byRow;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error("Sheet read kept returning 0 rows");
}

async function main(): Promise<void> {
  const config = loadConfig();
  const mapping = loadColumnMapping(config.mappingPath);
  const byRow = await readAuto(config.sheetWebhookUrl!, config.sheetId);

  const cleared: number[] = [];
  for (const rowIndex of ROWS) {
    const v = byRow.get(rowIndex) || {};
    const phone = String(v["Employer telephone number (online search)"] || "").trim();
    const status = String(v.Status || "").trim();
    console.log(
      `row ${rowIndex} phone=${JSON.stringify(phone)} status=${JSON.stringify(status.slice(0, 60))}`
    );
    if (!phone) {
      console.warn(`  skip — no phone on sheet`);
      continue;
    }
    if (!status) {
      console.log(`  already blank Status`);
      cleared.push(rowIndex);
      continue;
    }
    process.stdout.write(`  clear… `);
    await clearRowStatus(config, mapping, rowIndex, v.Email || "");
    console.log("ok");
    cleared.push(rowIndex);
  }
  removeLocalOutcomesForRows(cleared);
  removeProcessedRowIds(
    cleared.map((r) => String(byRow.get(r)?.["ID number"] || "")).filter(Boolean)
  );
  console.log(`Cleared ${cleared.length}: ROW_FILTER=${cleared.join(",")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
