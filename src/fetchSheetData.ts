import Papa from "papaparse";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ApplicantRecord, ColumnMapping, Compensation } from "./types.js";
import {
  fallbackAmount,
  fallbackText,
  pushCompensation,
  splitFullName,
  transformDate,
  transformIdNumber,
  transformMobile,
} from "./transforms.js";

const PROCESSED_COLUMN = "Processed";
const PROCESSED_LOG_FILE = "processed-rows.json";

export interface FetchOptions {
  csvUrl: string;
  mapping: ColumnMapping;
  rowFilter?: number[];
  localCsvPath?: string;
  skipProcessed?: boolean;
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
): { firstName: string; surname: string; original: string; compensated: boolean; reason?: string } {
  const firstFromCol = mapping.firstName ? getCell(row, mapping.firstName) : "";
  const surnameFromCol = mapping.surname ? getCell(row, mapping.surname) : "";
  if (firstFromCol && surnameFromCol && mapping.firstName !== mapping.surname) {
    return { firstName: firstFromCol, surname: surnameFromCol, original: `${firstFromCol} ${surnameFromCol}`, compensated: false };
  }

  const combined =
    (mapping.fullName ? getCell(row, mapping.fullName) : "") ||
    firstFromCol ||
    surnameFromCol;
  const split = splitFullName(combined);
  return {
    firstName: split.firstName,
    surname: split.surname,
    original: combined,
    compensated: split.compensated,
    reason: split.reason,
  };
}

function resolveNextOfKin(
  row: Record<string, string>,
  mapping: ColumnMapping
): { firstName: string; surname: string; original: string; compensated: boolean; reason?: string } {
  const firstFromCol = mapping.nextOfKinName ? getCell(row, mapping.nextOfKinName) : "";
  const surnameFromCol = mapping.nextOfKinSurname
    ? getCell(row, mapping.nextOfKinSurname)
    : "";
  if (
    firstFromCol &&
    surnameFromCol &&
    mapping.nextOfKinName !== mapping.nextOfKinSurname
  ) {
    return {
      firstName: firstFromCol,
      surname: surnameFromCol,
      original: `${firstFromCol} ${surnameFromCol}`,
      compensated: false,
    };
  }

  const combined =
    (mapping.nextOfKinFullName ? getCell(row, mapping.nextOfKinFullName) : "") ||
    firstFromCol ||
    surnameFromCol;
  const split = splitFullName(combined);
  return {
    firstName: split.firstName,
    surname: split.surname,
    original: combined,
    compensated: split.compensated,
    reason: split.reason,
  };
}

function mapRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  rowIndex: number
): ApplicantRecord {
  const compensations: Compensation[] = [];

  const name = resolveName(row, mapping);
  if (name.compensated) {
    compensations.push({
      field: "fullName",
      original: name.original,
      compensated: `${name.firstName} ${name.surname}`,
      reason: name.reason ?? "Name was compensated",
    });
  }

  const nextOfKin = resolveNextOfKin(row, mapping);
  if (nextOfKin.compensated) {
    compensations.push({
      field: "nextOfKin",
      original: nextOfKin.original,
      compensated: `${nextOfKin.firstName} ${nextOfKin.surname}`,
      reason: nextOfKin.reason ?? "Next of kin name was compensated",
    });
  }

  const mobileRaw = getCell(row, mapping.mobile);
  const mobileResult = transformMobile(mobileRaw);
  pushCompensation(compensations, "mobile", mobileRaw, mobileResult);

  const idRaw = getCell(row, mapping.idNumber);
  const idResult = transformIdNumber(idRaw);
  pushCompensation(compensations, "idNumber", idRaw, idResult);

  const residencyRaw = getCell(row, mapping.residencyStartDate);
  const residencyResult = transformDate(residencyRaw, "Residency start date");
  pushCompensation(compensations, "residencyStartDate", residencyRaw, residencyResult);

  const employmentRaw = getCell(row, mapping.employmentStartDate);
  const employmentResult = transformDate(employmentRaw, "Employment start date");
  pushCompensation(compensations, "employmentStartDate", employmentRaw, employmentResult);

  const employerPhoneRaw = getCell(row, mapping.employerPhone);
  const employerPhoneResult = transformMobile(employerPhoneRaw);
  pushCompensation(compensations, "employerPhone", employerPhoneRaw, employerPhoneResult);

  const nextOfKinPhoneRaw = mapping.nextOfKinPhone
    ? getCell(row, mapping.nextOfKinPhone)
    : "";
  const nextOfKinPhoneResult = transformMobile(nextOfKinPhoneRaw || "0600000000");
  if (nextOfKinPhoneRaw) {
    pushCompensation(compensations, "nextOfKinPhone", nextOfKinPhoneRaw, nextOfKinPhoneResult);
  }

  const emailRaw = getCell(row, mapping.email);
  const emailResult = fallbackText(
    emailRaw,
    `row${rowIndex}.applicant@autofill.local`,
    "Email"
  );
  pushCompensation(compensations, "email", emailRaw, emailResult);

  const addressResult = fallbackText(
    getCell(row, mapping.addressLine1),
    "Address not provided",
    "Address"
  );
  pushCompensation(compensations, "addressLine1", getCell(row, mapping.addressLine1), addressResult);

  const postalResult = fallbackText(getCell(row, mapping.postalCode), "0000", "Postal code");
  pushCompensation(compensations, "postalCode", getCell(row, mapping.postalCode), postalResult);

  const employerNameResult = fallbackText(
    getCell(row, mapping.employerName),
    "Unknown Employer",
    "Employer name"
  );
  pushCompensation(compensations, "employerName", getCell(row, mapping.employerName), employerNameResult);

  const employerAddressResult = fallbackText(
    getCell(row, mapping.employerAddress),
    addressResult.value,
    "Employer address"
  );
  pushCompensation(
    compensations,
    "employerAddress",
    getCell(row, mapping.employerAddress),
    employerAddressResult
  );

  const employerPostalResult = fallbackText(
    getCell(row, mapping.employerPostalCode),
    postalResult.value,
    "Employer postal code"
  );
  pushCompensation(
    compensations,
    "employerPostalCode",
    getCell(row, mapping.employerPostalCode),
    employerPostalResult
  );

  const grossResult = fallbackAmount(getCell(row, mapping.grossMonthly), "Gross monthly");
  pushCompensation(compensations, "grossMonthly", getCell(row, mapping.grossMonthly), grossResult);

  const nettResult = fallbackAmount(getCell(row, mapping.nettSalary), "Nett salary");
  pushCompensation(compensations, "nettSalary", getCell(row, mapping.nettSalary), nettResult);

  const telExp = fallbackAmount(getCell(row, mapping.telephoneExpense), "Telephone expense");
  pushCompensation(compensations, "telephoneExpense", getCell(row, mapping.telephoneExpense), telExp);

  const transportExp = fallbackAmount(getCell(row, mapping.transportExpense), "Transport expense");
  pushCompensation(compensations, "transportExpense", getCell(row, mapping.transportExpense), transportExp);

  const foodExp = fallbackAmount(getCell(row, mapping.foodExpense), "Food expense");
  pushCompensation(compensations, "foodExpense", getCell(row, mapping.foodExpense), foodExp);

  const accountRaw = getCell(row, mapping.accountHolder);
  const accountResult = fallbackText(
    accountRaw,
    `${name.firstName} ${name.surname}`.trim(),
    "Account holder"
  );
  pushCompensation(compensations, "accountHolder", accountRaw, accountResult);

  return {
    rowIndex,
    rowId: buildRowId(row, mapping, rowIndex),
    email: emailResult.value,
    firstName: name.firstName,
    surname: name.surname,
    idNumber: idResult.value,
    mobile: mobileResult.value,
    addressLine1: addressResult.value,
    postalCode: postalResult.value,
    residencyStartDate: residencyResult.value,
    nextOfKinName: nextOfKin.firstName,
    nextOfKinSurname: nextOfKin.surname,
    nextOfKinPhone: nextOfKinPhoneResult.value,
    employerName: employerNameResult.value,
    employerPhone: employerPhoneResult.value,
    employerAddress: employerAddressResult.value,
    employerPostalCode: employerPostalResult.value,
    employmentStartDate: employmentResult.value,
    grossMonthly: grossResult.value,
    nettSalary: nettResult.value,
    telephoneExpense: telExp.value,
    transportExpense: transportExp.value,
    foodExpense: foodExp.value,
    accountHolder: accountResult.value,
    processed: getCell(row, PROCESSED_COLUMN) || undefined,
    compensations,
  };
}

export function validateApplicant(applicant: ApplicantRecord): string[] {
  return applicant.compensations.map(
    (c) => `${c.field}: ${c.reason} (original "${c.original}" → "${c.compensated}")`
  );
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

  const processedLog = options.skipProcessed ? loadProcessedLog() : [];
  let rowNumber = 1;

  const applicants: ApplicantRecord[] = [];

  for (const row of parsed.data) {
    rowNumber++;
    if (options.rowFilter && options.rowFilter.length > 0) {
      if (!options.rowFilter.includes(rowNumber)) continue;
    }

    const emailRaw = getCell(row, options.mapping.email);
    const idRaw = getCell(row, options.mapping.idNumber);
    const nameRaw = options.mapping.fullName
      ? getCell(row, options.mapping.fullName)
      : [options.mapping.firstName, options.mapping.surname]
          .filter(Boolean)
          .map((h) => getCell(row, h as string))
          .join("");
    if (!emailRaw && !idRaw && !nameRaw) {
      console.log(`Skipping row ${rowNumber}: empty row`);
      continue;
    }

    const applicant = mapRow(row, options.mapping, rowNumber);

    if (options.skipProcessed && applicant.processed) {
      console.log(
        `Skipping row ${rowNumber} (${applicant.rowId}): already processed at ${applicant.processed}`
      );
      continue;
    }

    if (options.skipProcessed && processedLog.includes(applicant.rowId)) {
      console.log(`Skipping row ${rowNumber} (${applicant.rowId}): in local processed log`);
      continue;
    }

    if (applicant.compensations.length > 0) {
      console.log(
        `Row ${rowNumber} (${applicant.firstName} ${applicant.surname}): ${applicant.compensations.length} compensation(s)`
      );
      for (const c of applicant.compensations) {
        console.log(`  - ${c.reason}`);
      }
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
