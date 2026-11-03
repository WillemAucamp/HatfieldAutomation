import { loadConfig } from "../src/config.js";
import { approvedLeadsToCarry, approvedRowMissing } from "../src/loadedClientIdentity.js";
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

  const statusCounts = new Map<string, number>();
  for (const row of leads) {
    const label = row.status.trim() || "(blank)";
    statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1);
  }
  console.log(`Leads rows read: ${leads.length}`);
  console.log(`Approved rows read: ${approved.length}`);
  console.log("Status values on Leads:");
  for (const [label, count] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${JSON.stringify(label)}: ${count} (carry=${isApprovedForCarryTab(label)})`);
  }

  const missing = approvedLeadsToCarry(leads, approved, null);
  console.log(`\nMissing from Approved tab: ${missing.length}`);
  for (const row of missing.slice(0, 30)) {
    console.log(
      `  row ${row.rowIndex} | ${row.name} | ${JSON.stringify(row.status)} | ${row.number}`
    );
  }

  const damien = leads.find((row) => /pasich/i.test(row.name));
  if (damien) {
    console.log("\nDamien:", {
      rowIndex: damien.rowIndex,
      status: damien.status,
      number: damien.number,
      missing: approvedRowMissing(approved, damien.name, damien.number),
      carryEligible: isApprovedForCarryTab(damien.status),
    });
    const { normalizeLoadedPhone, sameLoadedPerson } = await import("../src/loadedClientIdentity.js");
    const phoneNorm = normalizeLoadedPhone(damien.number);
    const onApproved = approved.filter(
      (row) =>
        sameLoadedPerson(row.name, damien.name) ||
        (phoneNorm && normalizeLoadedPhone(row.number) === phoneNorm)
    );
    console.log("Damien matches on Approved tab:", onApproved.length);
    for (const row of onApproved.slice(0, 5)) {
      console.log(`  approved row ${row.rowIndex} | ${JSON.stringify(row.name)} | ${row.number}`);
    }
  }

  const oddStatuses = leads.filter(
    (row) => /approve/i.test(row.status) && !isApprovedForCarryTab(row.status)
  );
  if (oddStatuses.length) {
    console.log("\nApprove-like statuses NOT eligible for carry:");
    for (const row of oddStatuses) {
      console.log(`  row ${row.rowIndex} | ${row.name} | ${JSON.stringify(row.status)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
