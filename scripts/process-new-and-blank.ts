/**
 * Safe full-pipeline click after Enrichment Status was wiped:
 * 1) Mark intake rows already on the automation sheet as skipped_already_loaded
 * 2) Gemini-ingest remaining (truly new) Form rows
 * 3) Rebuild blank-Status automation rows from matching intake (ID/max/marital/expenses)
 * 4) Load every blank-Status automation row into Seriti
 *
 * Usage: npx tsx scripts/process-new-and-blank.ts
 */
import { loadConfig, loadColumnMapping } from "../src/config.js";
import { parseExpenseSummary } from "../src/intake/expenses.js";
import { firstFilled, normalizeHeader } from "../src/intake/headers.js";
import { ingestNewRows } from "../src/intake/ingest.js";
import { loadIntakeMapping } from "../src/intake/mapping.js";
import { buildOutputValues, DEFAULT_MAX_PRICE } from "../src/intake/row.js";
import { readSheetRows } from "../src/intake/sheets.js";
import { isMissingValue, parseDurationToMmDdYyyy } from "../src/transforms.js";
import { postWebhookJson } from "../src/sheetWriter.js";
import { runBatchMain } from "../src/runBatch.js";

function cellByNorm(values: Record<string, string>, want: string): string {
  const target = normalizeHeader(want);
  for (const [k, v] of Object.entries(values)) {
    if (normalizeHeader(k) === target) return String(v ?? "").trim();
  }
  return "";
}

function emailOf(values: Record<string, string>): string {
  for (const [k, v] of Object.entries(values)) {
    if (normalizeHeader(k).startsWith("email")) return String(v ?? "").trim().toLowerCase();
  }
  return "";
}

function nameOf(values: Record<string, string>): string {
  return (
    cellByNorm(values, "name and surname") ||
    cellByNorm(values, "full name") ||
    cellByNorm(values, "first names + surname")
  ).toLowerCase();
}

async function markAlreadyLoaded(
  webhookUrl: string,
  spreadsheetId: string,
  statusColumn: string,
  rowIndexes: number[]
): Promise<void> {
  const chunkSize = 40;
  for (let i = 0; i < rowIndexes.length; i += chunkSize) {
    const chunk = rowIndexes.slice(i, i + chunkSize);
    const updates = chunk.map((row) => ({
      row,
      column: statusColumn,
      value: "skipped_already_loaded",
    }));
    const res = await postWebhookJson(webhookUrl, {
      action: "updateSheet",
      spreadsheetId,
      updates,
    });
    if (res.ok === false) {
      throw new Error(String(res.error || "Failed to mark skipped_already_loaded"));
    }
    console.log(`Marked intake rows ${chunk[0]}–${chunk[chunk.length - 1]} as skipped_already_loaded`);
  }
}

async function rebuildBlankAutomationRows(config: ReturnType<typeof loadConfig>): Promise<number[]> {
  const mapping = loadIntakeMapping(config.intakeMappingPath);
  const intake = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    unprocessedOnly: false,
    statusColumn: config.intakeStatusColumn,
  });
  const auto = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.sheetId,
  });

  const intakeByEmail = new Map<string, (typeof intake)[0]>();
  for (const row of intake) {
    const email = emailOf(row.values);
    if (email) intakeByEmail.set(email, row);
  }

  const rebuilt: number[] = [];
  for (const autoRow of auto) {
    const status = String(autoRow.values.Status ?? "").trim();
    if (status) continue;

    const email = emailOf(autoRow.values);
    const intakeRow = email ? intakeByEmail.get(email) : undefined;
    if (!intakeRow) {
      console.warn(`Blank automation row ${autoRow.rowIndex}: no matching intake email — leave for gate`);
      continue;
    }

    const values = buildOutputValues(mapping, {}, intakeRow.values);
    // buildOutputValues already maps dedicated food/cellphone/accounts + summary parse.
    // Re-apply summary fold only if a bucket is still blank (defensive for older rows).
    const summary = firstFilled(intakeRow.values, [mapping.intake_headers.expenses_summary]);
    const parsed = parseExpenseSummary(summary);
    if ((!values["Food cost"] || isMissingValue(values["Food cost"])) && parsed.food) {
      values["Food cost"] = parsed.food;
    }
    if (
      (!values["Telephone payment"] || isMissingValue(values["Telephone payment"])) &&
      parsed.telephone
    ) {
      values["Telephone payment"] = parsed.telephone;
    }
    if (
      (!values["Transport cost"] || isMissingValue(values["Transport cost"])) &&
      parsed.transport
    ) {
      values["Transport cost"] = parsed.transport;
    }

    // Keep prior infer cells when rebuild left them blank.
    const inferKeep = [
      "Postal code",
      "Industry (AI based on employer)",
      "Employee level",
      "Employer telephone number (online search)",
      "Employer street address (online search)",
      "Employer postal code (online search)",
      "Employer province (online search)",
    ];
    for (const col of inferKeep) {
      const prev = String(autoRow.values[col] ?? "").trim();
      const cur = String(values[col] ?? "").trim();
      if (prev && !isMissingValue(prev) && (!cur || isMissingValue(cur))) {
        values[col] = prev;
      }
    }

    const lived = firstFilled(intakeRow.values, [mapping.intake_headers.years_at_address]);
    const livedDate = parseDurationToMmDdYyyy(lived);
    if (livedDate) {
      values["Year start living at address (MM DD YYYY format ONLY)"] = livedDate;
    }
    const employed = firstFilled(intakeRow.values, [mapping.intake_headers.years_at_employer]);
    const employedDate = parseDurationToMmDdYyyy(employed);
    if (employedDate) {
      values["Year they started working there (calculate from years provided)"] = employedDate;
    }

    values["Max price range"] = DEFAULT_MAX_PRICE;
    values.Status = "";
    values.Timing = "";

    const updates = Object.entries(values)
      .filter(([k]) => k !== "NR")
      .map(([column, value]) => ({
        row: autoRow.rowIndex,
        column,
        value: value ?? "",
      }));

    const res = await postWebhookJson(config.sheetWebhookUrl, {
      action: "updateSheet",
      spreadsheetId: config.sheetId,
      updates,
    });
    if (res.ok === false) {
      throw new Error(
        `Failed rebuilding automation row ${autoRow.rowIndex}: ${String(res.error || "unknown")}`
      );
    }
    console.log(
      `Rebuilt blank automation row ${autoRow.rowIndex} from intake ${intakeRow.rowIndex}` +
        ` id=${Boolean(values["ID number"])} max=${values["Max price range"]} marital=${values["Marital status"]}`
    );
    rebuilt.push(autoRow.rowIndex);
  }
  return rebuilt;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.sheetWebhookUrl) throw new Error("SHEET_WEBHOOK_URL is required");
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is required");

  const intake = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    unprocessedOnly: false,
    statusColumn: config.intakeStatusColumn,
  });
  const auto = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.sheetId,
  });

  const autoEmails = new Set<string>();
  const autoNames = new Set<string>();
  for (const row of auto) {
    const email = emailOf(row.values);
    const name = nameOf(row.values);
    if (email) autoEmails.add(email);
    if (name) autoNames.add(name);
  }

  const already: number[] = [];
  const fresh: number[] = [];
  for (const row of intake) {
    const st = String(row.status || "").trim();
    if (st) continue; // leave enriched / skipped alone
    const email = emailOf(row.values);
    const name = nameOf(row.values);
    const known = (email && autoEmails.has(email)) || (name && autoNames.has(name));
    if (known) already.push(row.rowIndex);
    else if (email || name) fresh.push(row.rowIndex);
  }

  console.log(
    JSON.stringify({
      intakeTotal: intake.length,
      alreadyOnAutomation: already.length,
      trulyNew: fresh.length,
      trulyNewRows: fresh,
      blankAutomation: auto.filter((r) => !String(r.values.Status || "").trim()).map((r) => r.rowIndex),
    })
  );

  if (already.length) {
    await markAlreadyLoaded(
      config.sheetWebhookUrl,
      config.intakeSpreadsheetId,
      config.intakeStatusColumn,
      already
    );
  }

  console.log(`Ingesting ${fresh.length} new Form row(s) with Gemini…`);
  const ingest = await ingestNewRows({
    ...config,
    maxIntakeRows: Math.max(fresh.length, 1),
    autoLoad: false,
    dryRun: false,
  });
  console.log(
    JSON.stringify({
      scanned: ingest.scanned,
      appended: ingest.appendedSheetRows,
      skipped: ingest.skipped,
      errors: ingest.errors,
      remaining: ingest.remaining,
    })
  );

  console.log("Rebuilding blank-Status automation rows from corrected intake…");
  const rebuilt = await rebuildBlankAutomationRows(config);
  console.log(`Rebuilt ${rebuilt.length} blank automation row(s)`);

  // Ensure load sees every blank Status (including newly appended).
  delete process.env.ROW_FILTER;
  process.env.HEADLESS = process.env.HEADLESS || "true";
  console.log("Loading every blank-Status automation row into Seriti…");
  await runBatchMain();
  console.log("Pipeline complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
