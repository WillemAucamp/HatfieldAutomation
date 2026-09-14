import Papa from "papaparse";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ApplicantRecord, ColumnMapping, DataError } from "./types.js";
import {
  requireAmount,
  requireEmail,
  requireText,
  restorePostalCode,
  splitFullName,
  splitNextOfKinName,
  transformMobile,
  validateDateFormat,
  validateIdNumber,
} from "./transforms.js";
import { successfulReferenceFromCell, isStatusPopulated } from "./outcome.js";
import { fetchSheetCsv } from "./sheetCsv.js";

const PROCESSED_COLUMN = "Processed";
const PROCESSED_LOG_FILE = "processed-rows.json";
const LOCAL_REFERENCES_FILE = "application-references.json";

export interface FetchOptions {
  csvUrl: string;
  mapping: ColumnMapping;
  rowFilter?: number[];
  localCsvPath?: string;
  skipProcessed?: boolean;
  /** Include rows that already have Status / a local reference (used for sheet sync). */
  includeCompleted?: boolean;
}

function getCell(row: Record<string, string>, columnHeader: string): string {
  return String(row[columnHeader] ?? "").trim();
}

function readStatusCell(row: Record<string, string>, mapping: ColumnMapping): string {
  const statusHeader = mapping.status ?? "Status";
  const fromStatus = getCell(row, statusHeader);
  if (fromStatus) return fromStatus;
  return getCell(row, "Reference Number");
}

function buildRowId(row: Record<string, string>, mapping: ColumnMapping, rowIndex: number): string {
  const id = getCell(row, mapping.idNumber);
  const email = getCell(row, mapping.email);
  return id || email || `row-${rowIndex}`;
}

function pushError(
  errors: DataError[],
  result: { valid: boolean; code?: string; message?: string; value?: string },
  field: string,
  raw: string
): void {
  if (result.valid || !result.code) return;
  errors.push({
    code: result.code,
    field,
    message: result.message ?? result.code,
    value: raw,
  });
}

function resolveName(
  row: Record<string, string>,
  mapping: ColumnMapping
): { firstName: string; surname: string; original: string; error?: DataError } {
  const firstFromCol = mapping.firstName ? getCell(row, mapping.firstName) : "";
  const surnameFromCol = mapping.surname ? getCell(row, mapping.surname) : "";
  if (firstFromCol && surnameFromCol && mapping.firstName !== mapping.surname) {
    return { firstName: firstFromCol, surname: surnameFromCol, original: `${firstFromCol} ${surnameFromCol}` };
  }

  const primary =
    (mapping.fullName ? getCell(row, mapping.fullName) : "") ||
    firstFromCol ||
    surnameFromCol;
  // Sheet often has both "First names + surname" and a separate "Full name" column.
  // Prefer the mapped column, but fall back to "Full name" when it lacks a surname.
  const fullNameFallback = getCell(row, "Full name");
  const candidates = [primary, fullNameFallback].filter(
    (v, i, arr) => Boolean(v) && arr.indexOf(v) === i
  );

  let combined = primary;
  let split = splitFullName(combined, "NAME_EMPTY", "NAME_MISSING_SURNAME", "Applicant name");
  for (const candidate of candidates) {
    const attempt = splitFullName(
      candidate,
      "NAME_EMPTY",
      "NAME_MISSING_SURNAME",
      "Applicant name"
    );
    if (attempt.valid) {
      combined = candidate;
      split = attempt;
      break;
    }
    combined = candidate;
    split = attempt;
  }

  return {
    firstName: split.firstName,
    surname: split.surname,
    original: combined,
    error: split.valid
      ? undefined
      : {
          code: split.code ?? "NAME_EMPTY",
          field: "fullName",
          message: split.message ?? "Applicant name is invalid",
          value: combined,
        },
  };
}

function resolveNextOfKin(
  row: Record<string, string>,
  mapping: ColumnMapping
): { firstName: string; surname: string; original: string; error?: DataError } {
  const firstFromCol = mapping.nextOfKinName ? getCell(row, mapping.nextOfKinName) : "";
  const surnameFromCol = mapping.nextOfKinSurname
    ? getCell(row, mapping.nextOfKinSurname)
    : "";
  if (firstFromCol && mapping.nextOfKinName !== mapping.nextOfKinSurname) {
    return {
      firstName: firstFromCol,
      surname: surnameFromCol || firstFromCol,
      original: `${firstFromCol} ${surnameFromCol || firstFromCol}`.trim(),
    };
  }

  const combined =
    (mapping.nextOfKinFullName ? getCell(row, mapping.nextOfKinFullName) : "") ||
    firstFromCol ||
    surnameFromCol;
  const split = splitNextOfKinName(combined);
  return {
    firstName: split.firstName,
    surname: split.surname,
    original: combined,
    error: split.valid
      ? undefined
      : {
          code: split.code ?? "NEXT_OF_KIN_EMPTY",
          field: "nextOfKin",
          message: split.message ?? "Next of kin name is invalid",
          value: combined,
        },
  };
}

function mapRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  rowIndex: number
): ApplicantRecord {
  const errors: DataError[] = [];

  const name = resolveName(row, mapping);
  if (name.error) errors.push(name.error);

  const nextOfKin = resolveNextOfKin(row, mapping);
  if (nextOfKin.error) errors.push(nextOfKin.error);

  const emailRaw = getCell(row, mapping.email);
  const emailResult = requireEmail(emailRaw);
  pushError(errors, emailResult, "email", emailRaw);

  const idRaw = getCell(row, mapping.idNumber);
  const idResult = validateIdNumber(idRaw);
  pushError(errors, idResult, "idNumber", idRaw);

  const mobileRaw = getCell(row, mapping.mobile);
  const mobileResult = transformMobile(mobileRaw);
  pushError(errors, mobileResult, "mobile", mobileRaw);

  const addressRaw = getCell(row, mapping.addressLine1);
  const addressResult = requireText(addressRaw, "ADDRESS_EMPTY", "Address is empty");
  pushError(errors, addressResult, "addressLine1", addressRaw);

  const postalRaw = getCell(row, mapping.postalCode);
  const postalResult = requireText(postalRaw, "POSTAL_EMPTY", "Postal code is empty");
  pushError(errors, postalResult, "postalCode", postalRaw);
  if (postalResult.valid) postalResult.value = restorePostalCode(postalResult.value);

  const residencyRaw = getCell(row, mapping.residencyStartDate);
  const residencyResult = validateDateFormat(
    residencyRaw,
    "Residency start date",
    "RESIDENCY_DATE_EMPTY",
    "RESIDENCY_DATE_FORMAT"
  );
  pushError(errors, residencyResult, "residencyStartDate", residencyRaw);

  const employmentRaw = getCell(row, mapping.employmentStartDate);
  const employmentResult = validateDateFormat(
    employmentRaw,
    "Employment start date",
    "EMPLOYMENT_DATE_EMPTY",
    "EMPLOYMENT_DATE_FORMAT"
  );
  pushError(errors, employmentResult, "employmentStartDate", employmentRaw);

  const nextOfKinPhoneRaw = mapping.nextOfKinPhone
    ? getCell(row, mapping.nextOfKinPhone)
    : "";
  const nextOfKinPhoneResult = nextOfKinPhoneRaw
    ? transformMobile(nextOfKinPhoneRaw)
    : { value: "", valid: true };
  if (nextOfKinPhoneRaw) {
    pushError(errors, nextOfKinPhoneResult, "nextOfKinPhone", nextOfKinPhoneRaw);
  }

  const employerNameRaw = getCell(row, mapping.employerName);
  const employerNameResult = requireText(
    employerNameRaw,
    "EMPLOYER_EMPTY",
    "Employer name is empty"
  );
  pushError(errors, employerNameResult, "employerName", employerNameRaw);

  const employerPhoneRaw = getCell(row, mapping.employerPhone);
  const employerPhoneResult = transformMobile(employerPhoneRaw);
  pushError(errors, employerPhoneResult, "employerPhone", employerPhoneRaw);

  const employerAddressRaw = getCell(row, mapping.employerAddress);
  const employerAddressResult = requireText(
    employerAddressRaw,
    "EMPLOYER_ADDRESS_EMPTY",
    "Employer address is empty"
  );
  pushError(errors, employerAddressResult, "employerAddress", employerAddressRaw);

  const employerPostalRaw = getCell(row, mapping.employerPostalCode);
  const employerPostalResult = requireText(
    employerPostalRaw,
    "EMPLOYER_POSTAL_EMPTY",
    "Employer postal code is empty"
  );
  pushError(errors, employerPostalResult, "employerPostalCode", employerPostalRaw);
  if (employerPostalResult.valid) {
    employerPostalResult.value = restorePostalCode(employerPostalResult.value);
  }

  const provinceRaw = mapping.province ? getCell(row, mapping.province) : getCell(row, "Province");
  const provinceResult = requireText(provinceRaw, "PROVINCE_EMPTY", "Province is empty");
  pushError(errors, provinceResult, "province", provinceRaw);

  const employerProvinceRaw = mapping.employerProvince
    ? getCell(row, mapping.employerProvince)
    : getCell(row, "Employer province (online search)");
  const employerProvinceResult = requireText(
    employerProvinceRaw,
    "EMPLOYER_PROVINCE_EMPTY",
    "Employer province is empty"
  );
  pushError(errors, employerProvinceResult, "employerProvince", employerProvinceRaw);

  const grossRaw = getCell(row, mapping.grossMonthly);
  const grossResult = requireAmount(grossRaw, "GROSS_EMPTY", "Gross monthly salary");
  pushError(errors, grossResult, "grossMonthly", grossRaw);

  const nettRaw = getCell(row, mapping.nettSalary);
  const nettResult = requireAmount(nettRaw, "NETT_EMPTY", "Nett salary");
  pushError(errors, nettResult, "nettSalary", nettRaw);

  const telRaw = getCell(row, mapping.telephoneExpense);
  const telResult = requireAmount(telRaw, "TELEPHONE_EXPENSE_EMPTY", "Telephone expense");
  pushError(errors, telResult, "telephoneExpense", telRaw);

  const transportRaw = getCell(row, mapping.transportExpense);
  const transportResult = requireAmount(transportRaw, "TRANSPORT_EXPENSE_EMPTY", "Transport expense");
  pushError(errors, transportResult, "transportExpense", transportRaw);

  const foodRaw = getCell(row, mapping.foodExpense);
  const foodResult = requireAmount(foodRaw, "FOOD_EXPENSE_EMPTY", "Food expense");
  pushError(errors, foodResult, "foodExpense", foodRaw);

  const accountRaw = getCell(row, mapping.accountHolder);
  const accountResult = requireText(
    accountRaw,
    "ACCOUNT_HOLDER_EMPTY",
    "Account holder is empty"
  );
  pushError(errors, accountResult, "accountHolder", accountRaw);

  const bankRaw = mapping.bank ? getCell(row, mapping.bank) : getCell(row, "Bank name");
  const bankResult = requireText(bankRaw, "BANK_EMPTY", "Bank name is empty");
  pushError(errors, bankResult, "bank", bankRaw);

  const accountTypeRaw = mapping.accountType
    ? getCell(row, mapping.accountType)
    : getCell(row, "Account type (AI—most likely option based on bank)");
  const accountTypeResult = requireText(
    accountTypeRaw,
    "ACCOUNT_TYPE_EMPTY",
    "Account type is empty"
  );
  pushError(errors, accountTypeResult, "accountType", accountTypeRaw);

  return {
    rowIndex,
    rowId: buildRowId(row, mapping, rowIndex),
    email: emailResult.value,
    firstName: name.firstName,
    surname: name.surname,
    idNumber: idResult.valid ? idResult.value : idRaw,
    mobile: mobileResult.valid ? mobileResult.value : mobileRaw,
    addressLine1: addressResult.value,
    postalCode: postalResult.value,
    province: provinceResult.value || "Gauteng",
    residencyStartDate: residencyResult.value,
    nextOfKinName: nextOfKin.firstName,
    nextOfKinSurname: nextOfKin.surname,
    nextOfKinPhone: nextOfKinPhoneResult.valid ? nextOfKinPhoneResult.value : nextOfKinPhoneRaw,
    employerName: employerNameResult.value,
    employerPhone: employerPhoneResult.valid ? employerPhoneResult.value : employerPhoneRaw,
    employerAddress: employerAddressResult.value,
    employerPostalCode: employerPostalResult.value,
    employerProvince: employerProvinceResult.value || provinceResult.value || "Gauteng",
    employmentStartDate: employmentResult.value,
    grossMonthly: grossResult.value,
    nettSalary: nettResult.value,
    telephoneExpense: telResult.value,
    transportExpense: transportResult.value,
    foodExpense: foodResult.value,
    accountHolder: accountResult.value,
    bank: bankResult.value,
    accountType: accountTypeResult.value,
    processed: getCell(row, PROCESSED_COLUMN) || undefined,
    existingStatus: readStatusCell(row, mapping) || undefined,
    errors,
  };
}

export function validateApplicant(applicant: ApplicantRecord): DataError[] {
  return applicant.errors;
}

export async function fetchSheetData(options: FetchOptions): Promise<ApplicantRecord[]> {
  let csvText: string;

  if (options.localCsvPath && existsSync(options.localCsvPath)) {
    csvText = readFileSync(options.localCsvPath, "utf-8");
  } else if (options.csvUrl) {
    csvText = await fetchSheetCsv(options.csvUrl);
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
  const localReferences = loadLocalReferences();
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

    if (!options.includeCompleted && isStatusPopulated(applicant.existingStatus)) {
      console.log(
        `Skipping row ${rowNumber}: Status already populated (${applicant.existingStatus})`
      );
      continue;
    }

    const localRef = successfulReferenceFromCell(localReferences[applicant.rowId]);
    if (!options.includeCompleted && localRef) {
      console.log(
        `Skipping row ${rowNumber} (${applicant.rowId}): already submitted locally (${localRef})`
      );
      continue;
    }

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

    if (applicant.errors.length > 0) {
      console.error(
        `Row ${rowNumber} (${applicant.firstName || "?"} ${applicant.surname || "?"}): DATA ERROR — not filling`
      );
      for (const err of applicant.errors) {
        console.error(`  [${err.code}] ${err.message}`);
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

function loadLocalReferences(): Record<string, string> {
  const path = join(process.cwd(), LOCAL_REFERENCES_FILE);
  if (!existsSync(path)) return {};
  try {
    const records = JSON.parse(readFileSync(path, "utf-8")) as Array<{
      rowId?: string;
      referenceNumber?: string;
      sheetStatus?: string;
    }>;
    const map: Record<string, string> = {};
    for (const record of records) {
      const status = record.sheetStatus ?? record.referenceNumber;
      const ref = successfulReferenceFromCell(status);
      if (record.rowId && ref) {
        map[record.rowId] = ref;
      }
    }
    return map;
  } catch {
    return {};
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
