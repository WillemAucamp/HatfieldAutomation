import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { ingestNewRows } from "./intake/ingest.js";
import { runBatchMain } from "./runBatch.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function watchIntakeMain(): Promise<void> {
  const once = process.argv.includes("--once");
  const skipLoad = process.argv.includes("--skip-load");
  const skipIngest = process.argv.includes("--skip-ingest");

  do {
    const config = loadConfig();
    if (!skipIngest && !config.geminiApiKey && !config.dryRun) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    let appendedSheetRows: number[] = [];

    if (skipIngest) {
      console.log(
        `\n[${new Date().toISOString()}] Skipping intake ingest. Loading automation sheet (blank Status${
          config.rowFilter.length ? ` or ROW_FILTER=${config.rowFilter.join(",")}` : ""
        })…`
      );
    } else {
      console.log(
        `\n[${new Date().toISOString()}] Checking intake sheet ${config.intakeSpreadsheetId}…`
      );
      const result = await ingestNewRows(config);
      appendedSheetRows = result.appendedSheetRows;
      console.log(
        `Intake: scanned=${result.scanned} appended=${result.appendedSheetRows.length} skipped=${result.skipped} remaining=${result.remaining} errors=${result.errors.length}`
      );
    }

    const shouldLoad = !skipLoad && config.autoLoad && !config.dryRun;
    if (shouldLoad) {
      if (skipIngest) {
        process.env.HEADLESS = process.env.HEADLESS || "true";
        await runBatchMain();
      } else if (appendedSheetRows.length > 0) {
        process.env.ROW_FILTER = appendedSheetRows.join(",");
        console.log(`Loading automation sheet rows ${process.env.ROW_FILTER} via Melrose autofill…`);
        process.env.HEADLESS = process.env.HEADLESS || "true";
        await runBatchMain();
        delete process.env.ROW_FILTER;
      } else {
        console.log(
          "No new intake rows. Skipping Melrose. Re-run with --skip-ingest (or mode=load-only) to retry blank-Status rows."
        );
      }
    } else if (appendedSheetRows.length > 0 && (skipLoad || !config.autoLoad)) {
      console.log(
        `Appended rows ${appendedSheetRows.join(", ")} with blank Status. Skipping Melrose load.`
      );
    }

    if (once) break;
    const wait = Math.max(config.pollSeconds, 15);
    console.log(`Sleeping ${wait}s until next intake poll`);
    await sleep(wait * 1000);
  } while (true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  watchIntakeMain().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
