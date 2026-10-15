import Papa from "papaparse";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ApplicantRecord, ColumnMapping, DataError } from "./types.js";
import {
  isMissingValue,
  parseMoneyAmount,
  requireAmount,
  requireEmail,
  requireText,
  restorePostalCode,
  splitFullName,
  splitNextOfKinName,
  initialsFromFirstNames,
  transformMobile,
  validateDateFormat,
  validateIdNumber,
  validateSalaryPair,
} from "./transforms.js";
import {
  copyResidentialOntoEmployer,
  isSelfEmployed,
  loadSeritiOptions,
  mapOccupation,
  selfEmployedOccupation,
} from "./intake/seritiOptions.js";
import { successfulReferenceFromCell, isStatusPopulated } from "./outcome.js";
import { fetchSheetCsv } from "./sheetCsv.js";
import { readSheetRows } from "./intake/sheets.js";

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
  /** Apps Script webhook — preferred over public CSV (gviz drops text ID/phone cells). */
  webhookUrl?: string;
  spreadsheetId?: string;
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
): { firstName: string; surname: string; initials: string; original: string; error?: DataError } {
  const firstFromCol = mapping.firstName ? getCell(row, mapping.firstName) : "";
  const surnameFromCol = mapping.surname ? getCell(row, mapping.surname) : "";
  if (firstFromCol && surnameFromCol && mapping.firstName !== mapping.surname) {
    if (firstFromCol.toLowerCase() === surnameFromCol.toLowerCase()) {
      return {
        firstName: firstFromCol,
        surname: "",
        initials: initialsFromFirstNames(firstFromCol),
        original: `${firstFromCol} ${surnameFromCol}`,
        error: {
          code: "NAME_MISSING_SURNAME",
          field: "fullName",
          message: `Applicant name "${firstFromCol} ${surnameFromCol}" has no surname (given name was duplicated)`,
          value: `${firstFromCol} ${surnameFromCol}`,
        },
      };
    }
    return {
      firstName: firstFromCol,
      surname: surnameFromCol,
      initials: initialsFromFirstNames(firstFromCol),
      original: `${firstFromCol} ${surnameFromCol}`,
    };
  }

  const primary =
    (mapping.fullName ? getCell(row, mapping.fullName) : "") ||
    firstFromCol ||
    surnameFromCol;
  const candidates = [
    primary,
    getCell(row, "Full name"),
    getCell(row, "First names + surname"),
  ].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

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
    initials: split.initials,
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
  if (firstFromCol && mapping.nextOfKinName && mapping.nextOfKinName !== mapping.nextOfKinSurname && surnameFromCol) {
    const split = splitNextOfKinName(`${firstFromCol} ${surnameFromCol}`);
    return {
      firstName: split.firstName,
      surname: split.surname,
      original: `${firstFromCol} ${surnameFromCol}`.trim(),
      error: split.valid
        ? undefined
        : {
            code: split.code ?? "NEXT_OF_KIN_EMPTY",
            field: "nextOfKin",
            message: split.message ?? "Next of kin name is invalid",
            value: `${firstFromCol} ${surnameFromCol}`.trim(),
          },
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

const SYSTEM_COLUMNS = new Set(["NR", "Status", "Timing", "Processed", "Reference Number"]);

/** Spouse cells stay empty for Single clients. Married rows are checked separately. */
const SPOUSE_COLUMNS = new Set([
  "Spouse Name + Surname",
  "Spouse number",
  "Spouse ID number",
  "Spouse ID",
  "Marital date",
  "Marital Date (MM DD YYYY)",
]);

function checkedSheetHeaders(mapping: ColumnMapping): Set<string> {
  return new Set(
    [
      mapping.email,
      mapping.fullName,
      mapping.firstName,
      mapping.surname,
      "Full name",
      mapping.title,
      "Title",
      mapping.educationalLevel,
      "Educational level",
      mapping.industry,
      "Industry (AI based on employer)",
      mapping.occupation,
      "Occupation",
      mapping.employeeLevel,
      "Employee level",
      mapping.maritalStatus,
      "Marital status",
      mapping.spouseFullName,
      "Spouse Name + Surname",
      mapping.spousePhone,
      "Spouse number",
      "Spouse ID number",
      "Spouse ID",
      "Marital date",
      "Marital Date (MM DD YYYY)",
      mapping.nextOfKinRelationship,
      "Next of kin relationship",
      mapping.maxPrice,
      "Max price range",
      mapping.idNumber,
      "ID number",
      mapping.mobile,
      "Mobile number",
      mapping.addressLine1,
      "Address line",
      mapping.postalCode,
      "Postal code",
      mapping.province,
      "Province",
      mapping.residencyStartDate,
      mapping.nextOfKinFullName,
      mapping.nextOfKinName,
      mapping.nextOfKinSurname,
      "Next of kin name + Surname",
      mapping.nextOfKinPhone,
      "Next of kin cellphone number",
      mapping.employerName,
      "Employer name",
      mapping.employerPhone,
      "Employer telephone number (online search)",
      mapping.employerAddress,
      "Employer street address (online search)",
      mapping.employerPostalCode,
      "Employer postal code (online search)",
      mapping.employerProvince,
      "Employer province (online search)",
      mapping.employmentStartDate,
      "Year they started working there (calculate from years provided)",
      mapping.grossMonthly,
      "Gross monthly salary",
      mapping.nettSalary,
      "Nett salary",
      mapping.telephoneExpense,
      "Telephone payment",
      mapping.transportExpense,
      "Transport cost",
      mapping.foodExpense,
      "Food cost",
      mapping.accountHolder,
      "Account holder name and surname (same as client)",
      mapping.bank,
      "Bank name",
      mapping.accountType,
      "Account type (AI—most likely option based on bank)",
    ].filter((header): header is string => Boolean(header))
  );
}

function flagUncheckedEmptyColumns(
  row: Record<string, string>,
  mapping: ColumnMapping,
  errors: DataError[],
  married: boolean
): void {
  const checked = checkedSheetHeaders(mapping);
  for (const [header, raw] of Object.entries(row)) {
    const name = header.trim();
    if (!name || SYSTEM_COLUMNS.has(name) || checked.has(name)) continue;
    if (SPOUSE_COLUMNS.has(name) && !married) continue;
    if (!isMissingValue(raw)) continue;
    errors.push({
      code: "COLUMN_EMPTY",
      field: name,
      message: `Missing information in "${name}"`,
      value: "",
    });
  }
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
  const employmentHeader =
    mapping.employmentStartDate || "Year they started working there (calculate from years provided)";
  const employmentResult = validateDateFormat(
    employmentRaw,
    employmentHeader,
    "EMPLOYMENT_DATE_EMPTY",
    "EMPLOYMENT_DATE_FORMAT"
  );
  pushError(errors, employmentResult, "employmentStartDate", employmentRaw);

  const nokPhoneHeader = mapping.nextOfKinPhone || "Next of kin cellphone number";
  const nextOfKinPhoneRaw = mapping.nextOfKinPhone
    ? getCell(row, mapping.nextOfKinPhone)
    : getCell(row, nokPhoneHeader);
  // Blank NOK phone is missing sheet data — block the load.
  // A Form typo ("076997746") must not block; leave Seriti unfilled.
  const nextOfKinPhoneResult = !isMissingValue(nextOfKinPhoneRaw)
    ? transformMobile(nextOfKinPhoneRaw)
    : { value: "", valid: false, code: "MOBILE_EMPTY" as const };
  if (isMissingValue(nextOfKinPhoneRaw)) {
    errors.push({
      code: "NOK_PHONE_EMPTY",
      field: "nextOfKinPhone",
      message: `Missing information in "${nokPhoneHeader}"`,
      value: "",
    });
  } else if (!nextOfKinPhoneResult.valid) {
    console.warn(
      `Row ${rowIndex}: skipping invalid next-of-kin mobile "${nextOfKinPhoneRaw}" (${nextOfKinPhoneResult.code})`
    );
  }

  const titleRaw = mapping.title ? getCell(row, mapping.title) : getCell(row, "Title");
  const titleResult = requireText(titleRaw, "TITLE_EMPTY", "Title is missing on the intake sheet");
  pushError(errors, titleResult, "title", titleRaw);

  const educationRaw = mapping.educationalLevel
    ? getCell(row, mapping.educationalLevel)
    : getCell(row, "Educational level");
  const educationResult = requireText(
    educationRaw,
    "EDUCATION_EMPTY",
    "Educational level is missing on the intake sheet"
  );
  pushError(errors, educationResult, "educationalLevel", educationRaw);

  const industryHeader = mapping.industry || "Industry (AI based on employer)";
  let industryRaw = mapping.industry
    ? getCell(row, mapping.industry)
    : getCell(row, industryHeader);

  const occupationHeader = mapping.occupation || "Occupation";
  let occupationRaw = mapping.occupation
    ? getCell(row, mapping.occupation)
    : getCell(row, occupationHeader);

  const levelRaw = mapping.employeeLevel
    ? getCell(row, mapping.employeeLevel)
    : getCell(row, "Employee level");
  const levelResult = requireText(
    levelRaw,
    "EMPLOYEE_LEVEL_EMPTY",
    "Employee level is missing (not on the intake sheet or could not be determined from job title)"
  );
  pushError(errors, levelResult, "employeeLevel", levelRaw);

  const spouseFullNameRaw = mapping.spouseFullName
    ? getCell(row, mapping.spouseFullName)
    : getCell(row, "Spouse Name + Surname");
  const spousePhoneRaw = mapping.spousePhone
    ? getCell(row, mapping.spousePhone)
    : getCell(row, "Spouse number");
  const spousePhoneResult = transformMobile(spousePhoneRaw);

  const maritalHeader = mapping.maritalStatus || "Marital status";
  const maritalRaw = mapping.maritalStatus
    ? getCell(row, mapping.maritalStatus)
    : getCell(row, maritalHeader);
  const maritalResult = requireText(
    maritalRaw,
    "MARITAL_STATUS_EMPTY",
    `Missing information in "${maritalHeader}"`
  );
  pushError(errors, maritalResult, "maritalStatus", maritalRaw);
  if (/married/i.test(maritalRaw) && !spouseFullNameRaw.trim()) {
    errors.push({
      code: "SPOUSE_NAME_EMPTY",
      field: "spouseFullName",
      message: "Marital status is Married but Spouse Name + Surname is empty",
      value: "",
    });
  }
  if (/married/i.test(maritalRaw) && !spousePhoneResult.valid) {
    errors.push({
      code: "SPOUSE_PHONE_EMPTY",
      field: "spousePhone",
      message:
        "Marital status is Married but Spouse number is missing or not a valid mobile",
      value: spousePhoneRaw,
    });
  }
  // Seriti Married requires Spouse ID Type + Spouse ID + Marital Date. Form does
  // not collect spouse ID/date. Marital date falls back to residency start.
  // Missing spouse ID hard-blocks — Seriti Personal Next will not advance without it.
  let spouseId = "";
  let maritalDate = "";
  if (/married/i.test(maritalRaw)) {
    const spouseIdRaw = getCell(row, "Spouse ID number") || getCell(row, "Spouse ID");
    const maritalDateRaw =
      getCell(row, "Marital date") || getCell(row, "Marital Date (MM DD YYYY)");
    spouseId = String(spouseIdRaw || "").replace(/\D/g, "");
    if (spouseId.length === 12) spouseId = `0${spouseId}`;
    if (!spouseId) {
      errors.push({
        code: "SPOUSE_ID_EMPTY",
        field: "spouseId",
        message:
          "Married requires Spouse ID on Seriti; add Spouse ID number on the sheet (Form does not collect it)",
        value: "",
      });
    }
    const maritalDateResult = validateDateFormat(
      maritalDateRaw,
      "Marital date",
      "MARITAL_DATE_EMPTY",
      "MARITAL_DATE_FORMAT"
    );
    maritalDate = maritalDateResult.valid ? maritalDateResult.value : "";
    if (!maritalDate) {
      errors.push({
        code: "MARITAL_DATE_EMPTY",
        field: "maritalDate",
        message:
          "Married requires Marital Date on Seriti; add Marital date on the sheet (Form does not collect it)",
        value: maritalDateRaw,
      });
    }
  }

  const nokRelRaw = mapping.nextOfKinRelationship
    ? getCell(row, mapping.nextOfKinRelationship)
    : getCell(row, "Next of kin relationship");
  const nokRelResult = requireText(
    nokRelRaw,
    "NOK_RELATIONSHIP_EMPTY",
    "Next of kin relationship is not on the intake sheet"
  );
  pushError(errors, nokRelResult, "nextOfKinRelationship", nokRelRaw);

  const maxPriceHeader = mapping.maxPrice || "Max price range";
  const maxPriceRaw = mapping.maxPrice
    ? getCell(row, mapping.maxPrice)
    : getCell(row, maxPriceHeader);
  const maxPriceResult = requireText(
    maxPriceRaw,
    "MAX_PRICE_EMPTY",
    `Missing information in "${maxPriceHeader}"`
  );
  pushError(errors, maxPriceResult, "maxPrice", maxPriceRaw);

  const employerNameRaw = getCell(row, mapping.employerName);
  const employerNameResult = requireText(
    employerNameRaw,
    "EMPLOYER_EMPTY",
    "Employer name is empty"
  );
  pushError(errors, employerNameResult, "employerName", employerNameRaw);

  // Seriti requires work telephone — empty employer phone blocks Work Next.
  const employerPhoneRaw = getCell(row, mapping.employerPhone);
  const employerPhoneResult = transformMobile(employerPhoneRaw);
  pushError(errors, employerPhoneResult, "employerPhone", employerPhoneRaw);

  const provinceRaw = mapping.province ? getCell(row, mapping.province) : getCell(row, "Province");
  const provinceResult = requireText(provinceRaw, "PROVINCE_EMPTY", "Province is empty");
  pushError(errors, provinceResult, "province", provinceRaw);

  const employerAddressHeader = mapping.employerAddress || "Employer street address (online search)";
  let employerAddressRaw = getCell(row, mapping.employerAddress);
  const employerPostalHeader = mapping.employerPostalCode || "Employer postal code (online search)";
  let employerPostalRaw = getCell(row, mapping.employerPostalCode);
  const employerProvinceHeader =
    mapping.employerProvince || "Employer province (online search)";
  let employerProvinceRaw = mapping.employerProvince
    ? getCell(row, mapping.employerProvince)
    : getCell(row, employerProvinceHeader);

  // Self-employed clients are loaded strictly as BUSINESS SERVICES / SELF EMPLOYED.
  // Their residential address is the only column that may fill employer address.
  const seriti = loadSeritiOptions();
  const selfEmployed = isSelfEmployed(occupationRaw, industryRaw, employerNameRaw);
  if (selfEmployed) {
    industryRaw = seriti.self_employed_industry;
    occupationRaw = selfEmployedOccupation(seriti);
    const copied = copyResidentialOntoEmployer({
      selfEmployed: true,
      residentialAddress: addressResult.value,
      residentialPostal: postalResult.value,
      residentialProvince: provinceResult.value,
      employerAddress: employerAddressRaw,
      employerPostal: employerPostalRaw,
      employerProvince: employerProvinceRaw,
    });
    employerAddressRaw = copied.employerAddress;
    employerPostalRaw = copied.employerPostal;
    employerProvinceRaw = copied.employerProvince;
  } else {
    // Remap sheet Occupation through Seriti menus so the old LABOURER (SKILLED)
    // default becomes OPERATOR even when the sheet was written before the change.
    occupationRaw = mapOccupation(occupationRaw, seriti);
  }

  const industryResult = requireText(
    industryRaw,
    "INDUSTRY_EMPTY",
    `Missing information in "${industryHeader}"`
  );
  pushError(errors, industryResult, "industry", industryRaw);

  const occupationResult = requireText(
    occupationRaw,
    "OCCUPATION_EMPTY",
    `Missing information in "${occupationHeader}"`
  );
  pushError(errors, occupationResult, "occupation", occupationRaw);

  const employerAddressResult = requireText(
    employerAddressRaw,
    "EMPLOYER_ADDRESS_EMPTY",
    `Missing information in "${employerAddressHeader}"`
  );
  pushError(errors, employerAddressResult, "employerAddress", employerAddressRaw);

  const employerPostalResult = requireText(
    employerPostalRaw,
    "EMPLOYER_POSTAL_EMPTY",
    `Missing information in "${employerPostalHeader}"`
  );
  pushError(errors, employerPostalResult, "employerPostalCode", employerPostalRaw);
  if (employerPostalResult.valid) {
    employerPostalResult.value = restorePostalCode(employerPostalResult.value);
  }

  const employerProvinceResult = requireText(
    employerProvinceRaw,
    "EMPLOYER_PROVINCE_EMPTY",
    `Missing information in "${employerProvinceHeader}"`
  );
  pushError(errors, employerProvinceResult, "employerProvince", employerProvinceRaw);

  const grossRaw = getCell(row, mapping.grossMonthly);
  const grossResult = requireAmount(grossRaw, "GROSS_EMPTY", "Gross monthly salary");
  pushError(errors, grossResult, "grossMonthly", grossRaw);
  if (grossResult.valid) {
    const amount = parseMoneyAmount(grossResult.value);
    if (amount != null) grossResult.value = String(Math.round(amount));
  }

  const nettRaw = getCell(row, mapping.nettSalary);
  const nettResult = requireAmount(nettRaw, "NETT_EMPTY", "Nett salary");
  pushError(errors, nettResult, "nettSalary", nettRaw);
  if (nettResult.valid) {
    const amount = parseMoneyAmount(nettResult.value);
    if (amount != null) nettResult.value = String(Math.round(amount));
  }

  if (grossResult.valid && nettResult.valid) {
    for (const salaryError of validateSalaryPair(grossResult.value, nettResult.value)) {
      errors.push(salaryError);
    }
  }

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
  // Form occasionally puts a postal/branch code in the bank column (e.g. "3800").
  if (bankResult.valid && /^\d+$/.test(bankResult.value.replace(/\s/g, ""))) {
    errors.push({
      code: "BANK_NOT_NAME",
      field: "bank",
      message: `Bank must be a Seriti bank name, not a number ("${bankResult.value}")`,
      value: bankResult.value,
    });
  }

  const accountTypeRaw = mapping.accountType
    ? getCell(row, mapping.accountType)
    : getCell(row, "Account type (AI—most likely option based on bank)");
  const accountTypeResult = requireText(
    accountTypeRaw,
    "ACCOUNT_TYPE_EMPTY",
    "Account type is empty"
  );
  pushError(errors, accountTypeResult, "accountType", accountTypeRaw);

  flagUncheckedEmptyColumns(row, mapping, errors, /married/i.test(maritalResult.value));

  return {
    rowIndex,
    rowId: buildRowId(row, mapping, rowIndex),
    email: emailResult.value,
    firstName: name.firstName,
    surname: name.surname,
    initials: name.initials,
    title: titleResult.value,
    educationalLevel: educationResult.value,
    idNumber: idResult.valid ? idResult.value : idRaw,
    mobile: mobileResult.valid ? mobileResult.value : mobileRaw,
    addressLine1: addressResult.value,
    postalCode: postalResult.value,
    province: provinceResult.value,
    residencyStartDate: residencyResult.value,
    nextOfKinName: nextOfKin.firstName,
    nextOfKinSurname: nextOfKin.surname,
    nextOfKinPhone: nextOfKinPhoneResult.valid ? nextOfKinPhoneResult.value : "",
    nextOfKinRelationship: nokRelResult.value,
    industry: industryResult.value,
    occupation: occupationResult.value,
    employeeLevel: levelResult.value,
    maritalStatus: maritalResult.value,
    spouseFullName: spouseFullNameRaw,
    spousePhone: spousePhoneResult.valid ? spousePhoneResult.value : spousePhoneRaw,
    spouseId: spouseId || undefined,
    maritalDate: maritalDate || undefined,
    maxPrice: maxPriceResult.value,
    employerName: employerNameResult.value,
    employerPhone: employerPhoneResult.valid ? employerPhoneResult.value : employerPhoneRaw,
    employerAddress: employerAddressResult.value,
    employerPostalCode: employerPostalResult.value,
    employerProvince: employerProvinceResult.value,
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

async function loadSheetRows(
  options: FetchOptions
): Promise<Array<{ rowIndex: number; values: Record<string, string> }>> {
  if (options.localCsvPath && existsSync(options.localCsvPath)) {
    return rowsFromCsv(readFileSync(options.localCsvPath, "utf-8"));
  }

  let webhookError: string | undefined;
  if (options.webhookUrl && options.spreadsheetId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const rows = await readSheetRows({
          webhookUrl: options.webhookUrl,
          spreadsheetId: options.spreadsheetId,
        });
        if (rows.length > 0) {
          console.log(`Fetched ${rows.length} sheet row(s) via Apps Script webhook`);
          return rows.map((row) => ({ rowIndex: row.rowIndex, values: row.values }));
        }
        webhookError = "webhook readSheet returned 0 rows";
      } catch (err) {
        webhookError = err instanceof Error ? err.message : String(err);
        console.warn(`Webhook readSheet failed (${webhookError})`);
      }
    }
    console.warn("Webhook readSheet returned no rows; falling back to public CSV");
  }

  let csvError: string | undefined;
  if (options.csvUrl) {
    try {
      const rows = rowsFromCsv(await fetchSheetCsv(options.csvUrl));
      if (rows.length > 0) return rows;
      csvError = "public CSV had no data rows";
    } catch (err) {
      csvError = err instanceof Error ? err.message : String(err);
      console.warn(`Public CSV fetch failed (${csvError})`);
    }
  }

  throw new Error(
    webhookError ||
      csvError ||
      "Either SHEET_WEBHOOK_URL, SHEET_CSV_URL, or a local CSV path must be provided"
  );
}

function rowsFromCsv(csvText: string): Array<{ rowIndex: number; values: Record<string, string> }> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    console.warn("CSV parse warnings:", parsed.errors.slice(0, 5));
  }

  return parsed.data.map((values, i) => ({ rowIndex: i + 2, values }));
}

export async function fetchSheetData(options: FetchOptions): Promise<ApplicantRecord[]> {
  const sheetRows = await loadSheetRows(options);
  const processedLog = options.skipProcessed ? loadProcessedLog() : [];
  const localReferences = loadLocalReferences();
  const applicants: ApplicantRecord[] = [];

  for (const { rowIndex, values: row } of sheetRows) {
    if (options.rowFilter && options.rowFilter.length > 0) {
      if (!options.rowFilter.includes(rowIndex)) continue;
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
      console.log(`Skipping row ${rowIndex}: empty row`);
      continue;
    }

    const applicant = mapRow(row, options.mapping, rowIndex);

    if (!options.includeCompleted && isStatusPopulated(applicant.existingStatus)) {
      console.log(
        `Skipping row ${rowIndex}: Status already populated (${applicant.existingStatus})`
      );
      continue;
    }

    const localRef = successfulReferenceFromCell(localReferences[applicant.rowId]);
    if (!options.includeCompleted && localRef) {
      console.log(
        `Skipping row ${rowIndex} (${applicant.rowId}): already submitted locally (${localRef})`
      );
      continue;
    }

    if (options.skipProcessed && applicant.processed) {
      console.log(
        `Skipping row ${rowIndex} (${applicant.rowId}): already processed at ${applicant.processed}`
      );
      continue;
    }

    if (options.skipProcessed && processedLog.includes(applicant.rowId)) {
      console.log(`Skipping row ${rowIndex} (${applicant.rowId}): in local processed log`);
      continue;
    }

    if (applicant.errors.length > 0) {
      console.error(
        `Row ${rowIndex} (${applicant.firstName || "?"} ${applicant.surname || "?"}): DATA ERROR — not filling`
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
