import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { loadConfig, loadColumnMapping } from "./config.js";
import { fetchSheetData, markRowProcessed } from "./fetchSheetData.js";
import type { FillContext } from "./fieldResolver.js";
import { clickApplyForFinance } from "./formUtils.js";
import { RunLogger, createWarning } from "./logger.js";
import {
  classifyRuntimeError,
  durationSeconds,
  formatErrorCell,
  successfulReferenceFromCell,
} from "./outcome.js";
import {
  goToUploadDocumentsThenSubmit,
  runSection1,
  runSection2,
  runSection3,
  runSection4,
  runSection5,
} from "./sections/index.js";
import { appendLoadedClient, writeRowOutcomeToSheet } from "./sheetWriter.js";
import type {
  ApplicantRecord,
  ApplicantRunResult,
  AppConfig,
  ColumnMapping,
  FieldWarning,
  RunStatus,
} from "./types.js";

async function processApplicant(
  browser: Browser,
  applicant: ApplicantRecord,
  logger: RunLogger,
  config: AppConfig,
  mapping: ColumnMapping,
  isLast: boolean
): Promise<ApplicantRunResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const applicantName = `${applicant.firstName} ${applicant.surname}`.trim();
  const screenshotDir = logger.applicantDir(applicant.rowIndex, applicantName);
  const warnings: FieldWarning[] = [];

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let sectionReached = 0;
  let status: RunStatus = "submitted";

  console.log(`\n=== Processing row ${applicant.rowIndex}: ${applicantName} (fresh session) ===`);

  const elapsed = () => durationSeconds(startedMs);

  if (applicant.errors.length > 0) {
    const errorCodes = applicant.errors.map((e) => e.code);
    const error = applicant.errors.map((e) => `[${e.code}] ${e.message}`).join("; ");
    console.error(`DATA ERROR for row ${applicant.rowIndex} (${applicantName || "unnamed"}):`);
    for (const err of applicant.errors) {
      console.error(`  [${err.code}] ${err.message}`);
    }
    console.error("Writing error to the sheet and continuing to the next applicant.");

    const result: ApplicantRunResult = {
      rowIndex: applicant.rowIndex,
      rowId: applicant.rowId,
      applicantName: applicantName || "(unnamed)",
      status: "data-error",
      sectionReached: 0,
      warnings: applicant.errors.map((e) =>
        createWarning(e.field, "data-error", `[${e.code}] ${e.message}`)
      ),
      screenshotDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      error,
      errorCodes,
      sheetStatus: formatErrorCell(errorCodes),
      durationSeconds: elapsed(),
    };
    await persistOutcome(config, mapping, applicant, result, warnings);
    return result;
  }

  if (applicant.existingStatus) {
    console.log(
      `Row ${applicant.rowIndex} Status already populated (${applicant.existingStatus}) — skipping.`
    );
    return {
      rowIndex: applicant.rowIndex,
      rowId: applicant.rowId,
      applicantName,
      status: "already-submitted",
      sectionReached: 6,
      warnings: [],
      screenshotDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      referenceNumber: applicant.existingStatus,
      sheetStatus: applicant.existingStatus,
      durationSeconds: elapsed(),
      writtenToSheet: true,
    };
  }

  try {
    context = await browser.newContext();
    page = await context.newPage();

    await page.goto(config.financeUrl, { waitUntil: "domcontentloaded" });
    const form = await clickApplyForFinance(page, config);

    const ctx: FillContext = {
      page,
      form,
      config,
      applicant,
      screenshotDir,
      warnings,
    };

    await runSection1(ctx);
    sectionReached = 1;

    await runSection2(ctx);
    sectionReached = 2;

    await runSection3(ctx);
    sectionReached = 3;

    await runSection4(ctx);
    sectionReached = 4;

    await runSection5(ctx);
    sectionReached = 5;

    if (config.dryRun) {
      status = "dry-run-complete";
      console.log(`[dry-run] Stopped after filling Section 5 for ${applicantName}`);

      return {
        rowIndex: applicant.rowIndex,
        rowId: applicant.rowId,
        applicantName,
        status,
        sectionReached,
        warnings,
        screenshotDir,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationSeconds: elapsed(),
      };
    }

    const referenceNumber = await goToUploadDocumentsThenSubmit(ctx);
    sectionReached = 6;
    status = "submitted";
    markRowProcessed(applicant.rowId);

    const result: ApplicantRunResult = {
      rowIndex: applicant.rowIndex,
      rowId: applicant.rowId,
      applicantName,
      status,
      sectionReached,
      warnings,
      screenshotDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      referenceNumber,
      sheetStatus: referenceNumber,
      durationSeconds: elapsed(),
    };
    await persistOutcome(config, mapping, applicant, result, warnings);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const errorCodes = [classifyRuntimeError(error, sectionReached)];
    console.error(`Failed on row ${applicant.rowIndex} (${applicantName}): ${error}`);
    console.error(`Error code: ${errorCodes[0]}. Continuing to the next applicant with a new session.`);

    if (page) {
      const failPath = join(screenshotDir, "failure.png");
      await page.screenshot({ path: failPath, fullPage: true }).catch(() => undefined);
    }

    const result: ApplicantRunResult = {
      rowIndex: applicant.rowIndex,
      rowId: applicant.rowId,
      applicantName,
      status: "failed",
      sectionReached,
      warnings,
      screenshotDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      error,
      errorCodes,
      sheetStatus: formatErrorCell(errorCodes),
      durationSeconds: elapsed(),
    };
    await persistOutcome(config, mapping, applicant, result, warnings);
    return result;
  } finally {
    const leaveOpen = config.keepLastOpen && isLast && !config.headless;
    if (leaveOpen && context) {
      console.log(
        `Left last session open for ${applicantName}. Close the browser when finished reviewing.`
      );
    } else if (context) {
      await context.close();
      console.log(`Closed session for ${applicantName}`);
    }
  }
}

async function persistOutcome(
  config: AppConfig,
  mapping: ColumnMapping,
  applicant: ApplicantRecord,
  result: ApplicantRunResult,
  warnings: FieldWarning[]
): Promise<void> {
  const sheetStatus = result.sheetStatus ?? formatErrorCell(result.errorCodes ?? ["SUBMIT_FAILED"]);
  const duration = result.durationSeconds ?? 0;
  try {
    const write = await writeRowOutcomeToSheet(config, mapping, applicant, sheetStatus, duration);
    result.writtenToSheet = write.writtenToSheet;
    result.sheetStatus = write.sheetStatus;
    result.durationSeconds = write.durationSeconds;
    if (!write.writtenToSheet && write.sheetError) {
      warnings.push(createWarning("status", "sheet-write", write.sheetError));
      result.warnings = warnings;
    }

    const reference = successfulReferenceFromCell(sheetStatus);
    if (reference) {
      const loaded = await appendLoadedClient(
        config,
        `${applicant.firstName} ${applicant.surname}`.trim(),
        reference
      );
      if (!loaded.written && loaded.error) {
        warnings.push(createWarning("loaded-clients", "sheet-write", loaded.error));
        result.warnings = warnings;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(createWarning("status", "sheet-write", msg));
    result.warnings = warnings;
    result.writtenToSheet = false;
    console.error(`Sheet write failed for row ${applicant.rowIndex}; continuing. ${msg}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const localCsvArg = process.argv.find((a) => a.startsWith("--local-csv"));
  const localCsvPath = localCsvArg?.includes("=")
    ? localCsvArg.split("=")[1]
    : localCsvArg
      ? process.argv[process.argv.indexOf(localCsvArg) + 1]
      : undefined;

  if (!config.sheetCsvUrl && !localCsvPath) {
    console.error(
      "SHEET_CSV_URL is not set. Copy .env.example to .env and set your public sheet CSV URL."
    );
    console.error("Alternatively, pass --local-csv path/to/file.csv");
    process.exit(1);
  }

  const mapping = loadColumnMapping(config.mappingPath);

  console.log(`Fetching applicant data${config.dryRun ? " (DRY RUN)" : ""}...`);
  const applicants = await fetchSheetData({
    csvUrl: config.sheetCsvUrl,
    mapping,
    rowFilter: config.rowFilter.length > 0 ? config.rowFilter : undefined,
    localCsvPath,
    skipProcessed: config.skipProcessed,
  });

  if (applicants.length === 0) {
    console.log("No applicants found.");
    return;
  }

  console.log(`Found ${applicants.length} applicant(s). Each row runs in a fresh browser session.`);

  const logger = new RunLogger(join(process.cwd(), "runs"), config.dryRun);
  console.log(`Run output directory: ${logger.getRunDir()}`);

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.headless ? 0 : 50,
  });

  try {
    for (let i = 0; i < applicants.length; i++) {
      const applicant = applicants[i];
      const result = await processApplicant(
        browser,
        applicant,
        logger,
        config,
        mapping,
        i === applicants.length - 1
      );
      logger.appendResult(result);
      logger.appendCsvSummary(result);
      console.log(
        `Result for ${result.applicantName}: ${result.status}` +
          `${result.sheetStatus ? ` sheet=${result.sheetStatus}` : ""}` +
          `${result.durationSeconds !== undefined ? ` ${result.durationSeconds}s` : ""}` +
          ` (section ${result.sectionReached})`
      );
    }
  } finally {
    if (!config.keepLastOpen || config.headless) {
      await browser.close();
    } else {
      console.log("\nBrowser process left running because --keep-last-open was set.");
    }
  }

  logger.flush();
  console.log(`\nBatch complete. Processed ${applicants.length} row(s). Log: ${logger.getRunDir()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
