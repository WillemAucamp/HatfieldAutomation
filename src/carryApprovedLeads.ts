/**
 * Copy recent Leads rows whose Status is Approved onto the Approved tab
 * when that client is not already there.
 *
 * Buhle Masinga (automation row 483) was approved on Leads and never copied
 * with the rest of that batch, so F&I working the Approved tab missed her.
 */
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import {
  approvedLeadsToCarry,
  approvedRowMissing,
  findOrphanPhoneRow,
} from "./loadedClientIdentity.js";
import {
  appendMoneySheetRow,
  overwriteMoneySheetRow,
  readMoneySheetRows,
  readMoneySheetTab,
} from "./sheetWriter.js";
import type { AppConfig } from "./types.js";

export async function carryRecentApprovedLeads(
  config: AppConfig,
  windowRows: number | null = 120
): Promise<string[]> {
  const leads = await readMoneySheetRows(
    config,
    config.leadsSheetGid,
    config.leadsNameColumn,
    config.leadsNumberColumn,
    config.leadsStatusColumn
  );
  const approvedTab = await readMoneySheetTab(
    config,
    config.approvedSheetGid,
    config.loadedNameColumn,
    config.loadedNumberColumn
  );
  const approvedRows = approvedTab.rows.map((row) => ({ ...row }));
  const missing = approvedLeadsToCarry(leads, approvedRows, windowRows);
  const usedOrphans = new Set<number>();
  const carried: string[] = [];
  for (const row of missing) {
    // Two Leads rows for the same client must not both land on the Approved tab.
    if (!approvedRowMissing(approvedRows, row.name, row.number)) continue;
    const orphanRow = findOrphanPhoneRow(approvedRows, row.number, usedOrphans);
    if (orphanRow) {
      await overwriteMoneySheetRow(
        config,
        config.approvedSheetGid,
        orphanRow,
        approvedTab.headers.length,
        row.name,
        row.number,
        row.comment ?? ""
      );
      usedOrphans.add(orphanRow);
      const stub = approvedRows.find((approved) => approved.rowIndex === orphanRow);
      if (stub) stub.name = row.name;
      console.log(
        `Approved tab: ${row.name} (Leads row ${row.rowIndex}) → reused phone-only row ${orphanRow}`
      );
    } else {
      await appendMoneySheetRow(
        config,
        config.approvedSheetGid,
        row.name,
        row.number,
        row.comment ?? ""
      );
      approvedRows.push({
        rowIndex: 0,
        name: row.name,
        number: row.number,
        status: "",
        comment: row.comment ?? "",
      });
      console.log(`Approved tab: ${row.name} (Leads row ${row.rowIndex})`);
    }
    carried.push(row.name);
  }
  return carried;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.sheetWebhookUrl && !config.loadedSheetWebhookUrl) {
    console.log("No SHEET_WEBHOOK_URL; skipping Approved-tab carry.");
    return;
  }
  const scanAll = process.argv.includes("--all");
  const windowRows = scanAll ? null : 120;
  const carried = await carryRecentApprovedLeads(config, windowRows);
  if (carried.length === 0) {
    console.log(
      scanAll
        ? "Approved tab already has every carry-eligible lead from Leads."
        : "Approved tab already has the recent Approved leads."
    );
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
