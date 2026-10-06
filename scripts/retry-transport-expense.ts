/**
 * After Transport-cost mapping fix: rebuild + clear Status for automation rows
 * that failed with TRANSPORT_EXPENSE_EMPTY (and optionally other soft errors),
 * then Seriti-load blank-Status rows.
 *
 * Usage: npx tsx scripts/retry-transport-expense.ts
 */
import { loadConfig } from "../src/config.js";
import { parseExpenseSummary } from "../src/intake/expenses.js";
import { firstFilled, normalizeHeader } from "../src/intake/headers.js";
import { loadIntakeMapping } from "../src/intake/mapping.js";
import { buildOutputValues, DEFAULT_MAX_PRICE } from "../src/intake/row.js";
import { readSheetRows } from "../src/intake/sheets.js";
import { isMissingValue, parseDurationToMmDdYyyy } from "../src/transforms.js";
import { postWebhookJson } from "../src/sheetWriter.js";
import { runBatchMain } from "../src/runBatch.js";

function emailOf(values: Record<string, string>): string {
  for (const [k, v] of Object.entries(values)) {
    if (normalizeHeader(k).startsWith("email")) return String(v ?? "").trim().toLowerCase();
  }
  return "";
}

async function main(): Promise<void> {
  const config = loadConfig();
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
  const skipped: Array<{ row: number; reason: string }> = [];

  for (const autoRow of auto) {
    const status = String(autoRow.values.Status ?? "").trim();
    if (!status.includes("TRANSPORT_EXPENSE_EMPTY")) continue;

    const email = emailOf(autoRow.values);
    const intakeRow = email ? intakeByEmail.get(email) : undefined;
    if (!intakeRow) {
      skipped.push({ row: autoRow.rowIndex, reason: "no matching intake email" });
      continue;
    }

    const values = buildOutputValues(mapping, {}, intakeRow.values);
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

    if (!values["Transport cost"] || isMissingValue(values["Transport cost"])) {
      skipped.push({
        row: autoRow.rowIndex,
        reason: `still no transport after rebuild (accounts=${JSON.stringify(
          firstFilled(intakeRow.values, [mapping.intake_headers.expense_accounts]).slice(0, 40)
        )})`,
      });
      // Still write rebuild so food/tel/accounts digits are clean, but leave Status as error.
      values.Status = status;
      values.Timing = String(autoRow.values.Timing ?? "");
    }

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
        `Failed updating automation row ${autoRow.rowIndex}: ${String(res.error || res)}`
      );
    }

    if (!values.Status) {
      rebuilt.push(autoRow.rowIndex);
      console.log(
        `Cleared+rebuilt row ${autoRow.rowIndex} transport=${values["Transport cost"]} food=${values["Food cost"]} tel=${values["Telephone payment"]}`
      );
    } else {
      console.log(
        `Updated row ${autoRow.rowIndex} but left Status (no transport digits)`
      );
    }
  }

  console.log(JSON.stringify({ rebuilt, skipped, rebuiltCount: rebuilt.length }, null, 2));

  if (rebuilt.length === 0) {
    console.log("Nothing to load.");
    return;
  }

  console.log(`Loading ${rebuilt.length} rebuilt row(s) into Seriti…`);
  process.env.HEADLESS = process.env.HEADLESS || "true";
  await runBatchMain();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
