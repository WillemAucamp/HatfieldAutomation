import { loadConfig } from "../src/config.js";
import {
  approvedRowMissing,
  normalizeLoadedPhone,
  sameLoadedPerson,
} from "../src/loadedClientIdentity.js";
import { isApprovedForCarryTab, normalizeLeadStatus } from "../src/leadStatus.js";
import { readMoneySheetRows } from "../src/sheetWriter.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const leads = await readMoneySheetRows(
    config,
    config.leadsSheetGid,
    config.leadsNameColumn,
    config.leadsNumberColumn,
    config.leadsStatusColumn
  );
  const approved = await readMoneySheetRows(
    config,
    config.approvedSheetGid,
    config.loadedNameColumn,
    config.loadedNumberColumn
  );

  console.log(`Leads last rowIndex: ${Math.max(...leads.map((r) => r.rowIndex), 0)}`);
  console.log("\nLast 8 Leads rows:");
  for (const row of leads.slice(-8)) {
    console.log(
      `  ${row.rowIndex} | ${JSON.stringify(row.name)} | ${JSON.stringify(row.status)} | ${JSON.stringify(row.number)} | phoneOk=${Boolean(normalizeLoadedPhone(row.number))}`
    );
  }

  const hits = leads.filter((row) => /willie|willem/i.test(row.name));
  console.log(`\nName matches willie/willem: ${hits.length}`);
  for (const row of hits) {
    const missing = approvedRowMissing(approved, row.name, row.number);
    const onApproved = approved.filter(
      (a) =>
        sameLoadedPerson(a.name, row.name) ||
        (normalizeLoadedPhone(row.number) &&
          normalizeLoadedPhone(a.number) === normalizeLoadedPhone(row.number))
    );
    console.log({
      rowIndex: row.rowIndex,
      name: row.name,
      status: row.status,
      statusNorm: normalizeLeadStatus(row.status),
      carryEligible: isApprovedForCarryTab(row.status),
      number: row.number,
      phoneNorm: normalizeLoadedPhone(row.number),
      missingFromApproved: missing,
      approvedMatches: onApproved.map((a) => ({ row: a.rowIndex, name: a.name, number: a.number })),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
