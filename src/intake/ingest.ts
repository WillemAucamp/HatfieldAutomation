import type { AppConfig } from "../types.js";
import { enrichWithGemini } from "./gemini.js";
import { assertIntakeHeadersPresent, cell, firstFilled, flattenRow, hasConsent } from "./headers.js";
import { loadIntakeMapping, requiredIntakeHeaderLabels } from "./mapping.js";
import { formatErrorCell } from "../outcome.js";
import { validateIdNumber } from "../transforms.js";
import { buildOutputValues } from "./row.js";
import {
  appendAutomationRow,
  isFailedEnrichmentRowZero,
  isUsableSheetRow,
  markIntakeStatus,
  readUnprocessedIntake,
  recoverAppendedAutomationRow,
} from "./sheets.js";

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
  const intakeTab = {
    sheetGid: config.intakeSheetGid,
    sheetName: config.intakeSheetName,
  };
  const allIntakeRows = await readUnprocessedIntake({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    statusColumn: config.intakeStatusColumn,
    ...intakeTab,
  });
  result.scanned = allIntakeRows.length;
  if (allIntakeRows.length > 0) {
    assertIntakeHeadersPresent(
      Object.keys(allIntakeRows[0]!.values),
      requiredIntakeHeaderLabels(mapping)
    );
  }
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
          ...intakeTab,
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
          ...intakeTab,
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
          ...intakeTab,
        });
      }

      console.log(`Enriching ${label} with Gemini…`);
      const startedMs = Date.now();
      const fields = await enrich(mapping, flattenRow(intake.values), {
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
      });
      console.log(`Gemini finished ${label} in ${((Date.now() - startedMs) / 1000).toFixed(1)}s`);
      const values = buildOutputValues(mapping, fields, intake.values);

      // Bad RSA IDs never pass Seriti Personal Next — stamp Status at ingest time.
      const idCheck = validateIdNumber(values["ID number"]);
      if (
        !idCheck.valid &&
        idCheck.code &&
        ["ID_CHECKSUM_INVALID", "ID_NOT_13_DIGITS"].includes(idCheck.code)
      ) {
        values.Status = formatErrorCell([idCheck.code]);
        console.warn(
          `${label}: ${idCheck.code} — appending with Status=${values.Status} (will not load)`
        );
      }

      if (dryRun) {
        console.log(`DRY RUN ${label}: would append`, values);
        continue;
      }

      // Prior run marked "enriched row 0" after a lost Apps Script confirmation —
      // reuse the automation row if it already exists instead of appending again.
      if (isFailedEnrichmentRowZero(intake.status)) {
        const existing = await recoverAppendedAutomationRow({
          webhookUrl: config.sheetWebhookUrl,
          spreadsheetId: config.sheetId,
          values,
        });
        if (existing && isUsableSheetRow(existing.row)) {
          result.appendedSheetRows.push(existing.row);
          await markIntakeStatus({
            webhookUrl: config.sheetWebhookUrl,
            spreadsheetId: config.intakeSpreadsheetId,
            rowIndex: intake.rowIndex,
            statusColumn: config.intakeStatusColumn,
            status: `enriched row ${existing.row} nr ${existing.nr}`,
            ...intakeTab,
          });
          console.log(
            `Recovered prior row-0 enrich for ${label} → automation sheet row ${existing.row} (NR ${existing.nr})`
          );
          continue;
        }
      }

      const written = await appendAutomationRow({
        webhookUrl: config.sheetWebhookUrl,
        spreadsheetId: config.sheetId,
        values,
      });
      if (!isUsableSheetRow(written.row)) {
        throw new Error(`appendApplicant returned unusable sheet row ${written.row}`);
      }
      result.appendedSheetRows.push(written.row);
      await markIntakeStatus({
        webhookUrl: config.sheetWebhookUrl,
        spreadsheetId: config.intakeSpreadsheetId,
        rowIndex: intake.rowIndex,
        statusColumn: config.intakeStatusColumn,
        status: `enriched row ${written.row} nr ${written.nr}`,
        ...intakeTab,
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
            ...intakeTab,
          });
        } catch (markErr) {
          console.error(`Could not mark error on ${label}:`, markErr);
        }
      }
    }
  }

  return result;
}
