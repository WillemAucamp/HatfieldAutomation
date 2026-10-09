import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { ingestNewRows } from "./intake/ingest.js";
import { runBatchMain } from "./runBatch.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function usableAutomationRows(rows: number[]): number[] {
  return rows.filter((row) => Number.isInteger(row) && row >= 2);
}

export interface MelroseLoadPlan {
  shouldLoad: boolean;
  /** When true, drop ROW_FILTER so leftover blank-Status rows load too. */
  clearRowFilter: boolean;
  log: string;
}

/** `full` always loads Seriti after ingest, even if this click appended nobody. */
export function planMelroseLoad(options: {
  skipLoad: boolean;
  autoLoad: boolean;
  dryRun: boolean;
  skipIngest: boolean;
  appendedSheetRows: number[];
}): MelroseLoadPlan {
  if (options.skipLoad || !options.autoLoad || options.dryRun) {
    const usable = usableAutomationRows(options.appendedSheetRows);
    return {
      shouldLoad: false,
      clearRowFilter: false,
      log: usable.length
        ? `Appended rows ${usable.join(", ")} with blank Status. Skipping Melrose load.`
        : "",
    };
  }

  if (options.skipIngest) {
    return { shouldLoad: true, clearRowFilter: false, log: "" };
  }

  const usable = usableAutomationRows(options.appendedSheetRows);
  if (usable.length > 0) {
    return {
      shouldLoad: true,
      clearRowFilter: true,
      log: `Ingest appended automation rows ${usable.join(", ")}. Loading every blank-Status row via Melrose.`,
    };
  }
  if (options.appendedSheetRows.length > 0) {
    return {
      shouldLoad: true,
      clearRowFilter: true,
      log:
        `Ingest reported sheet rows ${options.appendedSheetRows.join(", ")} which are not usable. ` +
        "Loading every blank-Status automation row instead.",
    };
  }
  return {
    shouldLoad: true,
    clearRowFilter: true,
    log: "No new intake rows this run. Loading leftover blank-Status automation rows via Melrose.",
  };
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
        `\n[${new Date().toISOString()}] Checking intake sheet ${config.intakeSpreadsheetId} tab ${config.intakeSheetName} (gid=${config.intakeSheetGid})…`
      );
      const result = await ingestNewRows(config);
      appendedSheetRows = result.appendedSheetRows;
      console.log(
        `Intake: scanned=${result.scanned} appended=${result.appendedSheetRows.length} skipped=${result.skipped} remaining=${result.remaining} errors=${result.errors.length}`
      );
    }

    const plan = planMelroseLoad({
      skipLoad,
      autoLoad: config.autoLoad,
      dryRun: config.dryRun,
      skipIngest,
      appendedSheetRows,
    });
    if (plan.log) {
      if (plan.shouldLoad && appendedSheetRows.length > 0 && usableAutomationRows(appendedSheetRows).length === 0) {
        console.warn(plan.log);
      } else {
        console.log(plan.log);
      }
    }

    if (plan.shouldLoad) {
      if (plan.clearRowFilter) {
        delete process.env.ROW_FILTER;
      }
      process.env.HEADLESS = process.env.HEADLESS || "true";
      await runBatchMain();
      if (plan.clearRowFilter) {
        delete process.env.ROW_FILTER;
      }
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
