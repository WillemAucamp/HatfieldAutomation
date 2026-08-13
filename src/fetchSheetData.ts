import Papa from "papaparse";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ApplicantRecord, ColumnMapping } from "./types.js";
import { splitFullName, transformMobile, validateDateFormat } from "./transforms.js";

const PROCESSED_COLUMN = "Processed";
const PROCESSED_LOG_FILE = "processed-rows.json";

export interface FetchOptions {
  csvUrl: string;
  mapping: ColumnMapping;
  rowFilter?: number[];
  localCsvPath?: string;
}

function getCell(row: Record<string, string>, columnHeader: string): string {
  return String(row[columnHeader] ?? "").trim();
}

function buildRowId(row: Record<string, string>, mapping: ColumnMapping, rowIndex: number): string {
  const id = getCell(row, mapping.idNumber);
  const email = getCell(row, mapping.email);
  return id || email || `row-${rowIndex}`;
}

function resolveName(
  row: Record<string, string>,
  mapping: ColumnMapping
): { firstName: string; surname: string } {
  const firstFromCol = mapping.firstName ? getCell(row, mapping.firstName) : "";
  const surnameFromCol = mapping.surname ? getCell(row, mapping.surname) : "";
  if (firstFromCol && surnameFromCol && mapping.firstName !== mapping.surname) {
    return { firstName: firstFromCol, surname: surnameFromCol };
  }

  const combined =
    (mapping.fullName ? getCell(row, mapping.fullName) : "") ||
    firstFromCol ||
    surnameFromCol;
  const split = splitFullName(combined);
  return { firstName: split.firstName, surname: split.surname };
}

function resolveNextOfKin(
  row: Record<string, string>,
  mapping: ColumnMapping
): { firstName: string; surname: string } {
  const firstFromCol = mapping.nextOfKinName ? getCell(row, mapping.nextOfKinName) : "";
  const surnameFromCol = mapping.nextOfKinSurname
    ? getCell(row, mapping.nextOfKinSurname)
    : "";
  if (
    firstFromCol &&
    surnameFromCol &&
    mapping.nextOfKinName !== mapping.nextOfKinSurname
  ) {
    return { firstName: firstFromCol, surname: surnameFromCol };
  }

  const combined =
    (mapping.nextOfKinFullName ? getCell(row, mapping.nextOfKinFullName) : "") ||
    firstFromCol ||
    surnameFromCol;
  const split = splitFullName(combined);
  return { firstName: split.firstName, surname: split.surname };
}

function mapRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  rowIndex: number
): ApplicantRecord {
  const mobileRaw = getCell(row, mapping.mobile);
  const mobileResult = transformMobile(mobileRaw);

  const residencyRaw = getCell(row, mapping.residencyStartDate);
  const residencyResult = validateDateFormat(residencyRaw, "Residency start date");

  const employmentRaw = getCell(row, mapping.employmentStartDate);
  const employmentResult = validateDateFormat(employmentRaw, "Employment start date");

  const { firstName, surname } = resolveName(row, mapping);
  const nextOfKin = resolveNextOfKin(row, mapping);

  const employerPhoneRaw = getCell(row, mapping.employerPhone);
  const employerPhoneResult = transformMobile(employerPhoneRaw);

  const nextOfKinPhoneRaw = mapping.nextOfKinPhone
    ? getCell(row, mapping.nextOfKinPhone)
    : "";
  const nextOfKinPhoneResult = nextOfKinPhoneRaw
    ? transformMobile(nextOfKinPhoneRaw)
    : undefined;

  return {
    rowIndex,
    rowId: buildRowId(row, mapping, rowIndex),
    email: getCell(row, mapping.email),
    firstName,
    surname,
    idNumber: getCell(row, mapping.idNumber),
    mobile: mobileResult.valid ? mobileResult.value : mobileRaw,
    addressLine1: getCell(row, mapping.addressLine1),
    postalCode: getCell(row, mapping.postalCode),
    residencyStartDate: residencyResult.valid ? residencyResult.value : residencyRaw,
    nextOfKinName: nextOfKin.firstName,
    nextOfKinSurname: nextOfKin.surname,
    nextOfKinPhone: nextOfKinPhoneResult?.valid
      ? nextOfKinPhoneResult.value
      : nextOfKinPhoneRaw || undefined,
    employerName: getCell(row, mapping.employerName),
    employerPhone: employerPhoneResult.valid ? employerPhoneResult.value : employerPhoneRaw,
    employerAddress: getCell(row, mapping.employerAddress),
    employerPostalCode: getCell(row, mapping.employerPostalCode),
    employmentStartDate: employmentResult.valid ? employmentResult.value : employmentRaw,
    grossMonthly: getCell(row, mapping.grossMonthly),
    nettSalary: getCell(row, mapping.nettSalary),
    telephoneExpense: getCell(row, mapping.telephoneExpense),
    transportExpense: getCell(row, mapping.transportExpense),
    foodExpense: getCell(row, mapping.foodExpense),
    accountHolder: getCell(row, mapping.accountHolder),
    processed: getCell(row, PROCESSED_COLUMN) || undefined,
  };
}

export function validateApplicant(applicant: ApplicantRecord): string[] {
  const issues: string[] = [];

  const mobileResult = transformMobile(applicant.mobile);
  if (!mobileResult.valid) {
    issues.push(mobileResult.reason ?? "Invalid mobile number");
  }

  const residencyResult = validateDateFormat(
    applicant.residencyStartDate,
    "Residency start date"
  );
  if (!residencyResult.valid) {
    issues.push(residencyResult.reason ?? "Invalid residency date");
  }

  const employmentResult = validateDateFormat(
    applicant.employmentStartDate,
    "Employment start date"
  );
  if (!employmentResult.valid) {
    issues.push(employmentResult.reason ?? "Invalid employment date");
  }

  if (!applicant.firstName || !applicant.surname) {
    issues.push("Could not split first name and surname from the sheet");
  }

  if (!applicant.nextOfKinName || !applicant.nextOfKinSurname) {
    issues.push("Could not split next-of-kin first name and surname from the sheet");
  }

  return issues;
}

export async function fetchSheetData(options: FetchOptions): Promise<ApplicantRecord[]> {
  let csvText: string;

  if (options.localCsvPath && existsSync(options.localCsvPath)) {
    csvText = readFileSync(options.localCsvPath, "utf-8");
  } else if (options.csvUrl) {
    const response = await fetch(options.csvUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch sheet CSV: ${response.status} ${response.statusText}`);
    }
    csvText = await response.text();
  } else {
    throw new Error("Either SHEET_CSV_URL or a local CSV path must be provided");
  }

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    console.warn("CSV parse warnings:", parsed.errors.slice(0, 5));
  }

  const processedLog = loadProcessedLog();
  let rowNumber = 1; // 1-based (header is not counted)

  const applicants: ApplicantRecord[] = [];

  for (const row of parsed.data) {
    rowNumber++;
    const applicant = mapRow(row, options.mapping, rowNumber);

    if (options.rowFilter && options.rowFilter.length > 0) {
      if (!options.rowFilter.includes(rowNumber)) continue;
    }

    if (applicant.processed) {
      console.log(`Skipping row ${rowNumber} (${applicant.rowId}): already processed at ${applicant.processed}`);
      continue;
    }

    if (processedLog.includes(applicant.rowId)) {
      console.log(`Skipping row ${rowNumber} (${applicant.rowId}): in local processed log`);
      continue;
    }

    if (!applicant.email && !applicant.idNumber) {
      console.log(`Skipping row ${rowNumber}: no email or ID number`);
      continue;
    }

    applicants.push(applicant);
  }

  return applicants;
}

function loadProcessedLog(): string[] {
  const logPath = join(process.cwd(), PROCESSED_LOG_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return JSON.parse(readFileSync(logPath, "utf-8")) as string[];
  } catch {
    return [];
  }
}

export function markRowProcessed(rowId: string): void {
  const logPath = join(process.cwd(), PROCESSED_LOG_FILE);
  const existing = loadProcessedLog();
  if (!existing.includes(rowId)) {
    existing.push(rowId);
    writeFileSync(logPath, JSON.stringify(existing, null, 2));
  }
  console.log(`Marked ${rowId} as processed in ${PROCESSED_LOG_FILE}`);
}

export async function fetchSheetDataFromUrl(
  csvUrl: string,
  mapping: ColumnMapping,
  rowFilter?: number[]
): Promise<ApplicantRecord[]> {
  return fetchSheetData({ csvUrl, mapping, rowFilter });
}
