import type { AppConfig } from "../types.js";
import { enrichWithGemini } from "./gemini.js";
import { cell, firstFilled, flattenRow, hasConsent } from "./headers.js";
import { loadIntakeMapping } from "./mapping.js";
import { buildOutputValues } from "./row.js";
import { appendAutomationRow, markIntakeStatus, readUnprocessedIntake } from "./sheets.js";

export interface IngestResult {
  scanned: number;
  appendedSheetRows: number[];
  skipped: number;
  errors: string[];
  remaining: number;
}

/** Keep leftover Form rows unprocessed so a later click can pick them up. */
export function capIntakeRows<T>(rows: T[], max: number): { rows: T[]; remaining: number } {
  if (!max || max <= 0 || rows.length <= max) {
    return { rows, remaining: 0 };
  }
  return { rows: rows.slice(0, max), remaining: rows.length - max };
}

export async function ingestNewRows(
  config: AppConfig,
  extras: { dryRun?: boolean; enrich?: typeof enrichWithGemini } = {}
): Promise<IngestResult> {
  const dryRun = extras.dryRun ?? config.dryRun;
  const result: IngestResult = {
    scanned: 0,
    appendedSheetRows: [],
    skipped: 0,
    errors: [],
    remaining: 0,
  };

  if (!config.sheetWebhookUrl) {
    throw new Error("SHEET_WEBHOOK_URL is required to read the intake sheet");
  }

  const mapping = loadIntakeMapping(config.intakeMappingPath);
  const allIntakeRows = await readUnprocessedIntake({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    statusColumn: config.intakeStatusColumn,
  });
  result.scanned = allIntakeRows.length;
  const capped = capIntakeRows(allIntakeRows, config.maxIntakeRows);
  result.remaining = capped.remaining;
  const intakeRows = capped.rows;
  if (result.remaining > 0) {
    console.log(
      `Capping ingest at ${intakeRows.length} of ${result.scanned} unprocessed Form rows (${result.remaining} left for a later run)`
    );
  }

  const enrich = extras.enrich ?? enrichWithGemini;

  for (const intake of intakeRows) {
    const name = firstFilled(intake.values, [
      mapping.intake_headers.name_and_surname,
      "Name and surname",
    ]);
    const label = `intake row ${intake.rowIndex}${name ? ` (${name})` : ""}`;
    const consent = cell(intake.values, mapping.intake_headers.consent);
    if (!hasConsent(consent) && consent) {
      result.skipped += 1;
      if (!dryRun) {
        await markIntakeStatus({
          webhookUrl: config.sheetWebhookUrl,
          spreadsheetId: config.intakeSpreadsheetId,
          rowIndex: intake.rowIndex,
          statusColumn: config.intakeStatusColumn,
          status: "skipped_no_consent",
        });
      }
      console.log(`Skip ${label}: consent not given`);
      continue;
    }
    if (!name) {
      result.skipped += 1;
      if (!dryRun) {
        await markIntakeStatus({
          webhookUrl: config.sheetWebhookUrl,
          spreadsheetId: config.intakeSpreadsheetId,
          rowIndex: intake.rowIndex,
          statusColumn: config.intakeStatusColumn,
          status: "skipped_empty",
        });
      }
      console.log(`Skip ${label}: no name`);
      continue;
    }

    try {
      if (!dryRun) {
        await markIntakeStatus({
          webhookUrl: config.sheetWebhookUrl,
          spreadsheetId: config.intakeSpreadsheetId,
          rowIndex: intake.rowIndex,
          statusColumn: config.intakeStatusColumn,
          status: "processing",
        });
      }

      console.log(`Enriching ${label} with Gemini…`);
      const startedMs = Date.now();
      const fields = await enrich(mapping, flattenRow(intake.values), {
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
      });
      console.log(`Gemini finished ${label} in ${((Date.now() - startedMs) / 1000).toFixed(1)}s`);
      const values = buildOutputValues(mapping, fields);

      if (dryRun) {
        console.log(`DRY RUN ${label}: would append`, values);
        continue;
      }

      const written = await appendAutomationRow({
        webhookUrl: config.sheetWebhookUrl,
        spreadsheetId: config.sheetId,
        values,
      });
      result.appendedSheetRows.push(written.row);
      await markIntakeStatus({
        webhookUrl: config.sheetWebhookUrl,
        spreadsheetId: config.intakeSpreadsheetId,
        rowIndex: intake.rowIndex,
        statusColumn: config.intakeStatusColumn,
        status: `enriched row ${written.row} nr ${written.nr}`,
      });
      console.log(`Enriched ${label} → automation sheet row ${written.row} (NR ${written.nr})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${label}: ${message}`);
      console.error(`Failed ${label}: ${message}`);
      if (!dryRun) {
        try {
          await markIntakeStatus({
            webhookUrl: config.sheetWebhookUrl,
            spreadsheetId: config.intakeSpreadsheetId,
            rowIndex: intake.rowIndex,
            statusColumn: config.intakeStatusColumn,
            status: `error ${message.slice(0, 180)}`,
          });
        } catch (markErr) {
          console.error(`Could not mark error on ${label}:`, markErr);
        }
      }
    }
  }

  return result;
}
