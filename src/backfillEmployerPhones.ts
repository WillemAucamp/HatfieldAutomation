/**
 * Brute-force employer telephone via Gemini google_search for rows that still
 * lack a usable work phone. Uses Form intake when matched; otherwise searches
 * from the automation sheet Employer name + city/province.
 *
 *   npx tsx src/backfillEmployerPhones.ts
 *   npx tsx src/backfillEmployerPhones.ts --dry-run
 *   npx tsx src/backfillEmployerPhones.ts --clear-status
 *   npx tsx src/backfillEmployerPhones.ts 290 291 299
 */
import { loadColumnMapping, loadConfig } from "./config.js";
import {
  enrichEmployerWithSearch,
  needsEmployerPhone,
  normalizeEmployerPhone,
} from "./intake/gemini.js";
import { cell, flattenRow } from "./intake/headers.js";
import { loadIntakeMapping } from "./intake/mapping.js";
import { readSheetRows } from "./intake/sheets.js";
import {
  clearRowStatus,
  postWebhookJson,
  removeLocalOutcomesForRows,
  removeProcessedRowIds,
} from "./sheetWriter.js";
import { isMissingValue } from "./transforms.js";

const PHONE = "Employer telephone number (online search)";
const STREET = "Employer street address (online search)";
const POSTAL = "Employer postal code (online search)";
const PROVINCE = "Employer province (online search)";

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

function matchIntake(
  auto: Record<string, string>,
  intakeRows: Array<{ rowIndex: number; values: Record<string, string> }>,
  mapping: ReturnType<typeof loadIntakeMapping>
): Record<string, string> | null {
  const email = norm(auto.Email || "");
  const id = String(auto["ID number"] || "").replace(/\D/g, "");
  const name = norm(auto["Full name"] || auto["First names + surname"] || "");

  for (const row of intakeRows) {
    const iEmail = norm(cell(row.values, mapping.intake_headers.email));
    const iId = cell(row.values, mapping.intake_headers.id_number).replace(/\D/g, "");
    const iName = norm(cell(row.values, mapping.intake_headers.name_and_surname));
    if (email && iEmail && email === iEmail) return row.values;
    if (id && iId && id === iId) return row.values;
    if (name && iName && name === iName) return row.values;
  }
  return null;
}

/** Build a Form-like blob so the search prompt still sees employer + location. */
function searchContextFromAuto(auto: Record<string, string>): string {
  return [
    `Name and surname: ${auto["Full name"] || auto["First names + surname"] || ""}`,
    `Name of Company you work for?: ${auto["Employer name"] || ""}`,
    `Job title?: ${auto.Occupation || ""}`,
    `City/Town Example: Pretoria/Cape Town/ Kimberley: ${auto["City/Town"] || auto.City || ""}`,
    `Province: ${auto.Province || ""}`,
    `Current STREET address and House number Example: 1058 Steve Biko Road: ${auto["Address line"] || ""}`,
    `Industry (AI based on employer): ${auto["Industry (AI based on employer)"] || ""}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const clearStatus = process.argv.includes("--clear-status");
  const onlyRows = parseRowArgs(process.argv.slice(2));
  const config = loadConfig();
  const mapping = loadIntakeMapping(config.intakeMappingPath);
  const columnMapping = loadColumnMapping(config.mappingPath);
  if (!config.sheetWebhookUrl) throw new Error("SHEET_WEBHOOK_URL required");
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY required");

  console.log("Reading automation sheet…");
  const parsed = await postWebhookJson(config.sheetWebhookUrl, {
    action: "readSheet",
    spreadsheetId: config.sheetId,
    gid: 0,
    unprocessedOnly: false,
  });
  if (parsed.ok === false) throw new Error(String(parsed.error || "readSheet failed"));

  const autoRows: Array<{ rowIndex: number; values: Record<string, string> }> = [];
  for (const row of Array.isArray(parsed.rows) ? parsed.rows : []) {
    const rec = row as { rowIndex?: number; values?: Record<string, string> };
    const rowIndex = Number(rec.rowIndex);
    if (!Number.isFinite(rowIndex)) continue;
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec.values ?? {})) {
      values[k] = v == null ? "" : String(v);
    }
    autoRows.push({ rowIndex, values });
  }

  console.log("Reading Form intake…");
  let intakeRows: Awaited<ReturnType<typeof readSheetRows>> = [];
  try {
    intakeRows = await readSheetRows({
      webhookUrl: config.sheetWebhookUrl,
      spreadsheetId: config.intakeSpreadsheetId,
      sheetName: "Form Responses 1",
      unprocessedOnly: false,
    });
  } catch (err) {
    console.warn(
      `Intake read failed (${err instanceof Error ? err.message : String(err)}); using sheet employer names only`
    );
  }
  console.log(`Intake rows: ${intakeRows.length}`);

  const targets = autoRows.filter((row) => {
    if (onlyRows.length && !onlyRows.includes(row.rowIndex)) return false;
    const status = String(row.values.Status || "").trim();
    if (/ZAHTVW/i.test(status)) return false; // already loaded
    if (!needsEmployerPhone(row.values)) return false;
    const employer = String(row.values["Employer name"] || "").trim();
    return Boolean(employer);
  });

  console.log(`Rows needing employer phone search: ${targets.length}`);
  if (!targets.length) return;

  const updates: Array<{ row: number; column: string; value: string }> = [];
  const filledRows: number[] = [];

  for (const row of targets) {
    const label = `row ${row.rowIndex} ${row.values["Full name"] || ""}`.trim();
    const employer = String(row.values["Employer name"] || "").trim();
    const intake = matchIntake(row.values, intakeRows, mapping);
    const formText = intake ? flattenRow(intake) : searchContextFromAuto(row.values);
    console.log(
      `Searching ${label} employer=${JSON.stringify(employer)} source=${intake ? "form" : "sheet"}…`
    );

    if (dryRun) {
      console.log(`  dry-run skip`);
      continue;
    }

    try {
      const found = await enrichEmployerWithSearch(
        mapping,
        formText,
        {
          apiKey: config.geminiApiKey,
          model: config.geminiModel,
          employerSearchAttempts: 3,
        },
        row.values
      );
      const phone = normalizeEmployerPhone(found[PHONE] ?? "");
      if (!phone) {
        console.warn(`  no usable phone after search`);
        continue;
      }
      console.log(`  found ${phone}`);
      updates.push({ row: row.rowIndex, column: PHONE, value: phone });
      for (const col of [STREET, POSTAL, PROVINCE] as const) {
        const value = String(found[col] ?? "").trim();
        if (!isMissingValue(value) && value !== String(row.values[col] ?? "").trim()) {
          updates.push({ row: row.rowIndex, column: col, value });
        }
      }
      filledRows.push(row.rowIndex);
    } catch (err) {
      console.warn(
        `  search failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log(`Prepared ${updates.length} cell update(s) for ${filledRows.length} row(s)`);
  if (dryRun || !updates.length) return;

  const chunkSize = 40;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const result = await postWebhookJson(config.sheetWebhookUrl, {
      action: "updateSheet",
      spreadsheetId: config.sheetId,
      updates: chunk,
    });
    if (result.ok === false) throw new Error(String(result.error || "updateSheet failed"));
    console.log(`Wrote updates ${i + 1}-${i + chunk.length}`);
  }

  if (clearStatus && filledRows.length) {
    console.log(`Clearing Status on ${filledRows.length} filled row(s) for retry…`);
    const autoByRow = new Map(autoRows.map((r) => [r.rowIndex, r.values]));
    for (const rowIndex of filledRows) {
      const email = autoByRow.get(rowIndex)?.Email || "";
      process.stdout.write(`  row ${rowIndex}… `);
      await clearRowStatus(config, columnMapping, rowIndex, email);
      console.log("ok");
    }
    removeLocalOutcomesForRows(filledRows);
    removeProcessedRowIds(
      filledRows
        .map((r) => String(autoByRow.get(r)?.["ID number"] || ""))
        .filter(Boolean)
    );
  }

  console.log(`Done. Filled phones on rows: ${filledRows.join(", ") || "(none)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
