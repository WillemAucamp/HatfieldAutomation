import { loadColumnMapping, loadConfig } from "./config.js";
import { successfulReferenceFromCell } from "./outcome.js";
import { appendLoadedClient, writeRowOutcomeToSheet } from "./sheetWriter.js";
import type { ApplicantRecord } from "./types.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface LocalRecord {
  rowIndex?: number;
  rowId?: string;
  email?: string;
  idNumber?: string;
  applicantName?: string;
  sheetStatus?: string;
  referenceNumber?: string;
  durationSeconds?: number;
}

function stubApplicant(record: LocalRecord): ApplicantRecord {
  const name = String(record.applicantName ?? "").trim();
  const space = name.lastIndexOf(" ");
  return {
    rowIndex: Number(record.rowIndex) || 0,
    rowId: String(record.rowId ?? record.idNumber ?? ""),
    email: String(record.email ?? ""),
    firstName: space > 0 ? name.slice(0, space) : name,
    surname: space > 0 ? name.slice(space + 1) : "",
    idNumber: String(record.idNumber ?? ""),
    mobile: "",
    addressLine1: "",
    postalCode: "",
    residencyStartDate: "",
    nextOfKinName: "",
    nextOfKinSurname: "",
    employerName: "",
    employerPhone: "",
    employerAddress: "",
    employerPostalCode: "",
    employmentStartDate: "",
    grossMonthly: "",
    nettSalary: "",
    telephoneExpense: "",
    transportExpense: "",
    foodExpense: "",
    accountHolder: "",
    bank: "",
    accountType: "",
    errors: [],
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const mapping = loadColumnMapping(config.mappingPath);
  const path = join(process.cwd(), "application-references.json");
  if (!existsSync(path)) {
    console.log("No application-references.json to sync.");
    return;
  }

  const records = JSON.parse(readFileSync(path, "utf-8")) as LocalRecord[];
  if (records.length === 0) {
    console.log("No local outcomes to sync.");
    return;
  }

  console.log(`Syncing ${records.length} outcome(s) to Status/Timing...`);
  for (const record of records) {
    const sheetStatus = String(record.sheetStatus ?? record.referenceNumber ?? "").trim();
    if (!sheetStatus) {
      console.warn(`  skip ${record.applicantName}: no status`);
      continue;
    }
    const applicant = stubApplicant(record);
    const write = await writeRowOutcomeToSheet(
      config,
      mapping,
      applicant,
      sheetStatus,
      record.durationSeconds
    );
    if (!write.writtenToSheet) {
      console.error(`  failed status ${record.applicantName}: ${write.sheetError}`);
    }
  }

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
