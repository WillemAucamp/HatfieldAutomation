import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { loadConfig, loadColumnMapping } from "./config.js";
import { fetchSheetData, markRowProcessed, validateApplicant } from "./fetchSheetData.js";
import type { FillContext } from "./fieldResolver.js";
import {
  clickApplyForFinance,
  clickNext,
  getVisibleStepText,
  isUploadDocumentsSection,
  screenshotSection,
} from "./formUtils.js";
import { RunLogger, createWarning } from "./logger.js";
import {
  runSection1,
  runSection2,
  runSection3,
  runSection4,
  runSection5,
} from "./sections/index.js";
import type { ApplicantRecord, ApplicantRunResult, FieldWarning, RunStatus } from "./types.js";
import { randomDelay } from "./utils.js";

async function processApplicant(
  browser: Browser,
  applicant: ApplicantRecord,
  logger: RunLogger,
  headless: boolean,
  dryRun: boolean
): Promise<ApplicantRunResult> {
  const startedAt = new Date().toISOString();
  const applicantName = `${applicant.firstName} ${applicant.surname}`.trim();
  const screenshotDir = logger.applicantDir(applicant.rowIndex, applicantName);
  const warnings: FieldWarning[] = [];

  const validationIssues = validateApplicant(applicant);
  if (validationIssues.length > 0) {
    return {
      rowIndex: applicant.rowIndex,
      rowId: applicant.rowId,
      applicantName,
      status: "manual-review-needed",
      sectionReached: 0,
      warnings: validationIssues.map((msg) =>
        createWarning("validation", "preflight", msg)
      ),
      screenshotDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: validationIssues.join("; "),
    };
  }

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let sectionReached = 0;
  let status: RunStatus = "stopped-at-uploads";
  let failed = false;

  try {
    const config = loadConfig();
    context = await browser.newContext();
    page = await context.newPage();

    console.log(`\n=== Processing row ${applicant.rowIndex}: ${applicantName} ===`);

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

    if (dryRun) {
      status = "dry-run-complete";
      console.log(`[dry-run] Stopped after filling Section 5 for ${applicantName}`);
    } else {
      await clickNext(form, config);
      await form.waitForLoadState("networkidle").catch(() => undefined);

      const bodyText = await getVisibleStepText(form);
      if (isUploadDocumentsSection(bodyText)) {
        status = "stopped-at-uploads";
        await screenshotSection(page, form, screenshotDir, "section6-upload", "before");
        console.log(`Ready for manual document upload for ${applicantName}`);
        markRowProcessed(applicant.rowId);

        const statePath = join(screenshotDir, "storage-state.json");
        await context.storageState({ path: statePath });
        console.log(`Saved resumable session to ${statePath}`);
      } else {
        status = "manual-review-needed";
        warnings.push(
          createWarning(
            "section6",
            "navigation",
            "Expected Upload Documents section but page content did not match"
          )
        );
      }
    }

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
    failed = true;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Failed on row ${applicant.rowIndex}: ${error}`);

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
    if (headless && context) {
      await context.close();
    } else if (context && !dryRun && status === "stopped-at-uploads") {
      console.log(`Browser left open for ${applicantName} — close manually when done.`);
    } else if (context && dryRun) {
      if (headless) await context.close();
    } else if (context && failed) {
      if (headless) await context.close();
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
  });

  if (applicants.length === 0) {
    console.log("No unprocessed applicants found.");
    return;
  }

  console.log(`Found ${applicants.length} applicant(s) to process.`);

  const logger = new RunLogger(join(process.cwd(), "runs"), config.dryRun);
  console.log(`Run output directory: ${logger.getRunDir()}`);

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.headless ? 0 : 50,
  });

  try {
    for (const applicant of applicants) {
      const result = await processApplicant(
        browser,
        applicant,
        logger,
        config.headless,
        config.dryRun
      );
      logger.appendResult(result);
      logger.appendCsvSummary(result);
      console.log(`Result: ${result.status} (section ${result.sectionReached})`);
    }
  } finally {
    if (config.headless) {
      await browser.close();
    } else {
      console.log("\nBrowser left open. Close it manually when finished reviewing.");
    }
  }

  logger.flush();
  console.log(`\nBatch complete. Log saved to ${logger.getRunDir()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
