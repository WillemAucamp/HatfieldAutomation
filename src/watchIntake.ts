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

  do {
    const config = loadConfig();
    if (!config.geminiApiKey && !config.dryRun) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    console.log(
      `\n[${new Date().toISOString()}] Checking intake sheet ${config.intakeSpreadsheetId}…`
    );
    const result = await ingestNewRows(config);
    console.log(
      `Intake: scanned=${result.scanned} appended=${result.appendedSheetRows.length} skipped=${result.skipped} errors=${result.errors.length}`
    );

    const shouldLoad = !skipLoad && config.autoLoad && !config.dryRun;
    if (shouldLoad) {
      if (result.appendedSheetRows.length > 0) {
        process.env.ROW_FILTER = result.appendedSheetRows.join(",");
        console.log(`Loading automation sheet rows ${process.env.ROW_FILTER} via Melrose autofill…`);
      } else {
        delete process.env.ROW_FILTER;
        console.log("No new intake rows. Checking automation sheet for blank-Status retries…");
      }
      process.env.HEADLESS = process.env.HEADLESS || "true";
      await runBatchMain();
      delete process.env.ROW_FILTER;
    } else if (result.appendedSheetRows.length > 0 && (skipLoad || !config.autoLoad)) {
      console.log(
        `Appended rows ${result.appendedSheetRows.join(", ")} with blank Status. Skipping Melrose load.`
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
