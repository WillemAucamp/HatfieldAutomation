import { loadConfig } from "./config.js";
import { successfulReferenceFromCell } from "./outcome.js";
import { appendLoadedClient } from "./sheetWriter.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface LocalRecord {
  applicantName?: string;
  sheetStatus?: string;
  referenceNumber?: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const path = join(process.cwd(), "application-references.json");
  if (!existsSync(path)) {
    console.log("No application-references.json to sync.");
    return;
  }

  const records = JSON.parse(readFileSync(path, "utf-8")) as LocalRecord[];
  const successes = records
    .map((r) => ({
      name: String(r.applicantName ?? "").trim(),
      number: successfulReferenceFromCell(r.sheetStatus ?? r.referenceNumber),
    }))
    .filter((r): r is { name: string; number: string } => Boolean(r.name && r.number));

  if (successes.length === 0) {
    console.log("No successful references to append.");
    return;
  }

  console.log(`Syncing ${successes.length} loaded client(s) to the Name/Number sheet...`);
  for (const row of successes) {
    const result = await appendLoadedClient(config, row.name, row.number);
    if (!result.written) {
      console.error(`  failed ${row.name}: ${result.error}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
