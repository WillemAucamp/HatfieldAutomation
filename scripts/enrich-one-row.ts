/**
 * Enrich a single intake Form row onto the automation sheet (no Seriti load).
 *
 * Usage:
 *   npx tsx scripts/enrich-one-row.ts --row=216
 */
import { loadConfig } from "../src/config.js";
import { enrichWithGemini } from "../src/intake/gemini.js";
import { cell, firstFilled, flattenRow, hasConsent } from "../src/intake/headers.js";
import { loadIntakeMapping } from "../src/intake/mapping.js";
import { buildOutputValues } from "../src/intake/row.js";
import {
  appendAutomationRow,
  markIntakeStatus,
  readSheetRows,
} from "../src/intake/sheets.js";

function parseRowArg(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith("--row=")) {
      const n = Number(arg.slice("--row=".length));
      if (Number.isInteger(n) && n >= 2) return n;
    }
    if (arg === "--row") continue;
  }
  const idx = argv.indexOf("--row");
  if (idx >= 0) {
    const n = Number(argv[idx + 1]);
    if (Number.isInteger(n) && n >= 2) return n;
  }
  throw new Error("Usage: npx tsx scripts/enrich-one-row.ts --row=216");
}

async function main(): Promise<void> {
  const rowIndex = parseRowArg(process.argv.slice(2));
  const config = loadConfig();
  if (!config.sheetWebhookUrl) throw new Error("SHEET_WEBHOOK_URL is required");
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is required");

  const mapping = loadIntakeMapping(config.intakeMappingPath);
  const rows = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    unprocessedOnly: false,
    statusColumn: config.intakeStatusColumn,
  });
  const intake = rows.find((r) => r.rowIndex === rowIndex);
  if (!intake) throw new Error(`Intake row ${rowIndex} not found`);

  const name = firstFilled(intake.values, [
    mapping.intake_headers.name_and_surname,
    "Name and surname",
  ]);
  const consent = cell(intake.values, mapping.intake_headers.consent);
  if (!hasConsent(consent) && consent) {
    throw new Error(`Intake row ${rowIndex}: consent not given`);
  }
  if (!name) throw new Error(`Intake row ${rowIndex}: no name`);

  console.log(`Enriching intake row ${rowIndex} (${name})…`);
  await markIntakeStatus({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    rowIndex,
    statusColumn: config.intakeStatusColumn,
    status: "processing",
  });

  const fields = await enrichWithGemini(mapping, flattenRow(intake.values), {
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
  });
  const values = buildOutputValues(mapping, fields, intake.values);
  const written = await appendAutomationRow({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.sheetId,
    values,
  });
  await markIntakeStatus({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    rowIndex,
    statusColumn: config.intakeStatusColumn,
    status: `enriched row ${written.row} nr ${written.nr}`,
  });
  console.log(
    JSON.stringify({
      intakeRow: rowIndex,
      automationRow: written.row,
      nr: written.nr,
      idFilled: Boolean(values["ID number"]),
      mobileFilled: Boolean(values["Mobile number"]),
      addressFilled: Boolean(values["Address line"]),
      educationFilled: Boolean(values["Educational level"]),
      foodFilled: Boolean(values["Food cost"]),
      telFilled: Boolean(values["Telephone payment"]),
      transportFilled: Boolean(values["Transport cost"]),
      empAddrFilled: Boolean(values["Employer street address (online search)"]),
      empPostalFilled: Boolean(values["Employer postal code (online search)"]),
      maritalFilled: Boolean(values["Marital status"]),
      nokFilled: Boolean(values["Next of kin name + Surname"]),
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
