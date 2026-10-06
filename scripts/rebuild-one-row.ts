/**
 * Rebuild one automation row from a corrected intake row WITHOUT Gemini.
 * Copies Form fields in code, applies deterministic date/expense fixes, and
 * optionally keeps prior infer cells (employer/industry/postal) from an old row.
 *
 * Usage:
 *   npx tsx scripts/rebuild-one-row.ts --intake=216 --from-auto=264
 */
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.js";
import { parseExpenseSummary } from "../src/intake/expenses.js";
import { firstFilled } from "../src/intake/headers.js";
import { loadIntakeMapping } from "../src/intake/mapping.js";
import { buildOutputValues } from "../src/intake/row.js";
import {
  appendAutomationRow,
  markIntakeStatus,
  readSheetRows,
} from "../src/intake/sheets.js";
import { isMissingValue, parseDurationToMmDdYyyy } from "../src/transforms.js";

function argNum(argv: string[], name: string): number | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) {
    const n = Number(eq.split("=")[1]);
    return Number.isInteger(n) && n >= 2 ? n : undefined;
  }
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0) {
    const n = Number(argv[idx + 1]);
    return Number.isInteger(n) && n >= 2 ? n : undefined;
  }
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const intakeRow = argNum(argv, "intake");
  const fromAuto = argNum(argv, "from-auto");
  if (!intakeRow) {
    throw new Error("Usage: npx tsx scripts/rebuild-one-row.ts --intake=216 [--from-auto=264]");
  }

  const config = loadConfig();
  if (!config.sheetWebhookUrl) throw new Error("SHEET_WEBHOOK_URL is required");

  const mapping = loadIntakeMapping(config.intakeMappingPath);
  const intakeRows = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    unprocessedOnly: false,
    statusColumn: config.intakeStatusColumn,
  });
  const intake = intakeRows.find((r) => r.rowIndex === intakeRow);
  if (!intake) throw new Error(`Intake row ${intakeRow} not found`);

  const name = firstFilled(intake.values, [
    mapping.intake_headers.name_and_surname,
    "Name and surname",
  ]);
  console.log(`Rebuilding from intake ${intakeRow} (${name}) without Gemini…`);

  const values = buildOutputValues(mapping, {}, intake.values);

  const summary = firstFilled(intake.values, [mapping.intake_headers.expenses_summary]);
  const parsed = parseExpenseSummary(summary);
  if (!values["Food cost"] && parsed.food) values["Food cost"] = parsed.food;
  if (!values["Telephone payment"] && parsed.telephone) {
    values["Telephone payment"] = parsed.telephone;
  }
  if (!values["Transport cost"] && parsed.transport) {
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
  if (fromAuto) {
    const autoRows = await readSheetRows({
      webhookUrl: config.sheetWebhookUrl,
      spreadsheetId: config.sheetId,
      unprocessedOnly: false,
      statusColumn: "Status",
    });
    const prior = autoRows.find((r) => r.rowIndex === fromAuto);
    if (!prior) throw new Error(`Automation row ${fromAuto} not found`);
    for (const col of inferKeep) {
      const prev = String(prior.values[col] ?? "").trim();
      const cur = String(values[col] ?? "").trim();
      if (prev && !isMissingValue(prev) && (!cur || isMissingValue(cur))) {
        values[col] = prev;
      }
    }
  }

  const lived = firstFilled(intake.values, [mapping.intake_headers.years_at_address]);
  const livedDate = parseDurationToMmDdYyyy(lived);
  if (livedDate) {
    values["Year start living at address (MM DD YYYY format ONLY)"] = livedDate;
  }
  const employed = firstFilled(intake.values, [mapping.intake_headers.years_at_employer]);
  const employedDate = parseDurationToMmDdYyyy(employed);
  if (employedDate) {
    values["Year they started working there (calculate from years provided)"] = employedDate;
  }

  values.Status = "";
  values.Timing = "";

  const written = await appendAutomationRow({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.sheetId,
    values,
  });

  await markIntakeStatus({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    rowIndex: intakeRow,
    statusColumn: config.intakeStatusColumn,
    status: `enriched row ${written.row} nr ${written.nr}`,
  });

  console.log(
    JSON.stringify({
      intakeRow,
      fromAuto: fromAuto ?? null,
      automationRow: written.row,
      nr: written.nr,
      idFilled: Boolean(values["ID number"]),
      addressFilled: Boolean(values["Address line"]),
      education: String(values["Educational level"] || "").slice(0, 20),
      food: values["Food cost"] || "",
      tel: values["Telephone payment"] || "",
      transport: values["Transport cost"] || "",
      postal: Boolean(values["Postal code"]),
      industry: Boolean(values["Industry (AI based on employer)"]),
      empAddr: Boolean(values["Employer street address (online search)"]),
      empPostal: Boolean(values["Employer postal code (online search)"]),
      empPhone: Boolean(values["Employer telephone number (online search)"]),
      nok: Boolean(values["Next of kin name + Surname"]),
    })
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
