/**
 * Copy recent Leads rows whose Status is Approved onto the Approved tab
 * when that client is not already there.
 *
 * Buhle Masinga (automation row 483) was approved on Leads and never copied
 * with the rest of that batch, so F&I working the Approved tab missed her.
 */
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { approvedLeadsToCarry } from "./loadedClientIdentity.js";
import { appendMoneySheetRow, readMoneySheetRows } from "./sheetWriter.js";
import type { AppConfig } from "./types.js";

export async function carryRecentApprovedLeads(
  config: AppConfig,
  windowRows = 120
): Promise<string[]> {
  const leads = await readMoneySheetRows(
    config,
    config.leadsSheetGid,
    config.leadsNameColumn,
    config.leadsNumberColumn,
    config.leadsStatusColumn
  );
  const approvedTab = await readMoneySheetRows(
    config,
    config.approvedSheetGid,
    config.loadedNameColumn,
    config.loadedNumberColumn
  );
  const missing = approvedLeadsToCarry(leads, approvedTab, windowRows);
  const carried: string[] = [];
  for (const row of missing) {
    await appendMoneySheetRow(config, config.approvedSheetGid, row.name, row.number);
    carried.push(row.name);
    console.log(`Approved tab: ${row.name} (Leads row ${row.rowIndex})`);
  }
  return carried;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.sheetWebhookUrl && !config.loadedSheetWebhookUrl) {
    console.log("No SHEET_WEBHOOK_URL; skipping Approved-tab carry.");
    return;
  }
  const carried = await carryRecentApprovedLeads(config);
  if (carried.length === 0) {
    console.log("Approved tab already has the recent Approved leads.");
    return;
  }
  console.log(`Carried ${carried.length} approved lead(s) onto the Approved tab.`);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
