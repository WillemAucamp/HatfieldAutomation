/**
 * Validate that a client's applicant sheet is reachable as CSV and has the
 * columns required by their mapping — without opening Seriti.
 *
 * Usage:
 *   npm run validate-sheet -- --client acme
 *   npm run validate-sheet -- --sheet SHEET_ID [--mapping ./mapping.json]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getClient, listClientConfigs } from "../src/product/clients.js";
import { fetchSheetCsv, gvizCsvUrl } from "../src/sheetCsv.js";
import type { ColumnMapping } from "../src/types.js";
import Papa from "papaparse";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

const REQUIRED_FIELDS: (keyof ColumnMapping)[] = [
  "email",
  "idNumber",
  "mobile",
  "addressLine1",
  "postalCode",
  "residencyStartDate",
  "employerName",
  "employerPhone",
  "employerAddress",
  "employerPostalCode",
  "employmentStartDate",
  "grossMonthly",
  "nettSalary",
  "accountHolder",
];

async function main(): Promise<void> {
  const clientId = arg("client");
  let sheetId = arg("sheet") ?? "";
  let mappingPath = arg("mapping") ?? "./mapping.json";
  let gid = arg("gid") ?? "0";

  if (clientId) {
    const client = getClient(clientId);
    if (!client) {
      console.error(`Unknown client: ${clientId}`);
      console.error(
        `Configured: ${listClientConfigs()
          .map((c) => c.id)
          .join(", ") || "(none)"}`
      );
      process.exit(1);
    }
    sheetId = client.sheetId;
    mappingPath = client.mappingPath || mappingPath;
    gid = client.sheetGid || gid;
    console.log(`Client: ${client.displayName} (${client.id})`);
  }

  if (!sheetId) {
    console.error("Pass --client <id> or --sheet <SHEET_ID>");
    process.exit(1);
  }

  const absMapping = resolve(mappingPath);
  if (!existsSync(absMapping)) {
    console.error(`Mapping not found: ${absMapping}`);
    process.exit(1);
  }
  const mapping = JSON.parse(readFileSync(absMapping, "utf-8")) as ColumnMapping;

  const csvUrl = gvizCsvUrl(sheetId, gid);
  console.log(`Fetching: ${csvUrl}`);

  let csv: string;
  try {
    csv = await fetchSheetCsv(csvUrl);
  } catch (err) {
    console.error("FAILED to fetch sheet CSV.");
    console.error(err instanceof Error ? err.message : err);
    console.error(
      "\nFix: share the sheet so CSV export works (Anyone with the link can view),\nor ensure the sheet ID is correct."
    );
    process.exit(1);
  }

  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const headers = parsed.meta.fields ?? [];
  console.log(`Rows (data): ${parsed.data.length}`);
  console.log(`Headers (${headers.length}): ${headers.join(" | ")}`);

  const missing: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    const headerName = mapping[field];
    if (!headerName) continue;
    const found = headers.some((h) => h.trim() === headerName.trim());
    if (!found) missing.push(`${field} → "${headerName}"`);
  }

  // Name can be fullName or firstName+surname
  const hasFull = mapping.fullName && headers.some((h) => h.trim() === mapping.fullName!.trim());
  const hasParts =
    mapping.firstName &&
    mapping.surname &&
    headers.some((h) => h.trim() === mapping.firstName!.trim()) &&
    headers.some((h) => h.trim() === mapping.surname!.trim());
  if (!hasFull && !hasParts) {
    missing.push(
      `name → "${mapping.fullName ?? ""}" or "${mapping.firstName ?? ""}" + "${mapping.surname ?? ""}"`
    );
  }

  const statusHeader = mapping.status ?? "Status";
  if (!headers.some((h) => h.trim() === statusHeader)) {
    console.warn(`WARN: Status column "${statusHeader}" missing — write-back may add it via webhook.`);
  }

  if (missing.length) {
    console.error("\nMISSING mapped columns:");
    for (const m of missing) console.error(`  - ${m}`);
    console.error(
      "\nFix: rename sheet headers to match mapping.json, or create clients/<id>.mapping.json."
    );
    process.exit(1);
  }

  const openRows = parsed.data.filter((row) => !String(row[statusHeader] ?? "").trim()).length;
  console.log(`\nOK — sheet readable. Open rows (empty Status): ${openRows}`);
  console.log("Safe to point the product at this client once Apps Script write-back is deployed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
