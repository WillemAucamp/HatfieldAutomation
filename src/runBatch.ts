import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { loadConfig, loadColumnMapping } from "./config.js";
import { fetchSheetData, markRowProcessed } from "./fetchSheetData.js";
import type { FillContext } from "./fieldResolver.js";
import { clickApplyForFinance } from "./formUtils.js";
import { RunLogger, createWarning } from "./logger.js";
import {
  goToUploadDocumentsThenSubmit,
  runSection1,
  runSection2,
  runSection3,
  runSection4,
  runSection5,
} from "./sections/index.js";
import { writeReferenceToSheet } from "./sheetWriter.js";
import type {
  ApplicantRecord,
  ApplicantRunResult,
  AppConfig,
  ColumnMapping,
  FieldWarning,
  RunStatus,
} from "./types.js";
import { randomDelay } from "./utils.js";

async function processApplicant(
  browser: Browser,
  applicant: ApplicantRecord,
  logger: RunLogger,
  config: AppConfig,
  mapping: ColumnMapping,
  isLast: boolean
): Promise<ApplicantRunResult> {
  const startedAt = new Date().toISOString();
  const applicantName = `${applicant.firstName} ${applicant.surname}`.trim();
  const screenshotDir = logger.applicantDir(applicant.rowIndex, applicantName);
  const warnings: FieldWarning[] = [];

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let sectionReached = 0;
  let status: RunStatus = "submitted";

  console.log(`\n=== Processing row ${applicant.rowIndex}: ${applicantName} (fresh session) ===`);

  if (applicant.errors.length > 0) {
    const errorCodes = applicant.errors.map((e) => e.code);
    const error = applicant.errors.map((e) => `[${e.code}] ${e.message}`).join("; ");
    console.error(`DATA ERROR for row ${applicant.rowIndex} (${applicantName || "unnamed"}):`);
    for (const err of applicant.errors) {
      console.error(`  [${err.code}] ${err.message}`);
    }
    console.error("Skipping this row (human error in sheet data). Continuing to the next applicant.");

    return {
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
    };
  }

  if (applicant.existingReference) {
    console.log(
      `Row ${applicant.rowIndex} already has reference ${applicant.existingReference} — skipping to avoid a duplicate application.`
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
      referenceNumber: applicant.existingReference,
      writtenToSheet: true,
    };
  }

  try {
    context = await browser.newContext();
    page = await context.newPage();

    await page.goto(config.financeUrl, { waitUntil: "networkidle" });
    await randomDelay(config);
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
    } else {
      const referenceNumber = await goToUploadDocumentsThenSubmit(ctx);
      sectionReached = 6;
      status = "submitted";
      markRowProcessed(applicant.rowId);

      const write = await writeReferenceToSheet(config, mapping, applicant, referenceNumber);
      if (!write.writtenToSheet && write.sheetError) {
        warnings.push(
          createWarning("referenceNumber", "sheet-write", write.sheetError)
        );
      }

      const statePath = join(screenshotDir, "storage-state.json");
      await context.storageState({ path: statePath });
      console.log(`Saved session state to ${statePath}`);

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
        referenceNumber,
        writtenToSheet: write.writtenToSheet,
      };
    }

    const statePath = join(screenshotDir, "storage-state.json");
    await context.storageState({ path: statePath });
    console.log(`Saved session state to ${statePath}`);

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
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Failed on row ${applicant.rowIndex} (${applicantName}): ${error}`);
    console.error("Continuing to the next applicant with a new session.");

    if (page) {
      const failPath = join(screenshotDir, "failure.png");
      await page.screenshot({ path: failPath, fullPage: true }).catch(() => undefined);
    }

    return {
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
    };
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
        `Result for ${result.applicantName}: ${result.status}${
          result.referenceNumber ? ` ref=${result.referenceNumber}` : ""
        }${result.errorCodes?.length ? ` [${result.errorCodes.join(", ")}]` : ""} (section ${result.sectionReached})`
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
