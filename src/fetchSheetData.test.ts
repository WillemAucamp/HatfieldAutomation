import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadColumnMapping } from "./config.js";
import { fetchSheetData } from "./fetchSheetData.js";

const HEADERS = [
  "NR",
  "Full name",
  "Email",
  "Title",
  "First names + surname",
  "ID Type",
  "ID number",
  "Educational level",
  "Mobile number",
  "Address line",
  "Postal code",
  "Province",
  "Year start living at address (MM DD YYYY format ONLY)",
  "Next of kin name + Surname",
  "Next of kin cellphone number",
  "Industry (AI based on employer)",
  "Occupation",
  "Employee level",
  "Employer name",
  "Employer telephone number (online search)",
  "Employer street address (online search)",
  "Employer postal code (online search)",
  "Employer province (online search)",
  "Year they started working there (calculate from years provided)",
  "Gross monthly salary",
  "Nett salary",
  "Telephone payment",
  "Transport cost",
  "Food cost",
  "Bank name",
  "Account type (AI—most likely option based on bank)",
  "Account holder name and surname (same as client)",
  "Client cellphone number (add again at the end)",
  "Status",
  "Timing",
];

describe("fetchSheetData", () => {
  it("reads ID, mobile, and telephone payment from an export-style CSV row", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "row.csv");
    const values = [
      "55",
      "Mothoka Jefferson Oupa Sekhwela",
      "sekhwelaoupa83@gmail.com",
      "Mr",
      "Mothoka Jefferson Oupa Sekhwela",
      "South African ID",
      "8304015345083",
      "Grade 12",
      "0629095338",
      "1528 Park Town, Church Street, Kgapane",
      "830",
      "Limpopo",
      "01 10 1986",
      "David Moraba",
      "0761182316",
      "Legal Services / Law Enforcement",
      "Deputy Sheriff",
      "Mid-Level",
      "Sheriff Musina",
      "0155342200",
      "112 Irwin Street, Musina",
      "900",
      "Limpopo",
      "12 10 2022",
      "11000",
      "11000",
      "1000",
      "500",
      "2000",
      "Capitec",
      "Savings/Transactional",
      "Mothoka Jefferson Oupa Sekhwela",
      "0629095338",
      "",
      "",
    ];
    const csv = [HEADERS, values]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });

    assert.equal(applicants.length, 1);
    const row = applicants[0]!;
    assert.equal(row.idNumber, "8304015345083");
    assert.equal(row.mobile, "0629095338");
    assert.equal(row.telephoneExpense, "1000");
    assert.equal(row.maritalStatus, "");
    assert.ok(row.errors.some((e) => e.code === "MARITAL_STATUS_EMPTY" && /Marital status/.test(e.message)));
    assert.ok(row.errors.some((e) => e.code === "NOK_RELATIONSHIP_EMPTY"));
    assert.ok(row.errors.some((e) => e.code === "MAX_PRICE_EMPTY" && /Max price range/.test(e.message)));
    assert.deepEqual(
      row.errors.filter((e) =>
        ["ID_EMPTY", "MOBILE_EMPTY", "TELEPHONE_EXPENSE_EMPTY"].includes(
          e.code
        )
      ),
      []
    );
  });

  it("does not duplicate a single given name into the surname", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "mono.csv");
    const values = [
      "351",
      "Lucky",
      "lucky@example.com",
      "Mr",
      "Lucky",
      "South African ID",
      "9204015306086",
      "Grade 12",
      "0821234567",
      "1 Main Road",
      "2196",
      "Gauteng",
      "10 08 1996",
      "Friend Name",
      "0821234568",
      "Retail",
      "Clerk",
      "Staff",
      "Shop",
      "0111234567",
      "2 Work Ave",
      "2196",
      "Gauteng",
      "10 08 2024",
      "15000",
      "12000",
      "200",
      "300",
      "500",
      "Capitec",
      "Savings/Transactional",
      "Lucky",
      "0821234567",
      "",
      "",
    ];
    const csv = [HEADERS, values]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });
    const row = applicants[0]!;
    assert.equal(row.firstName, "Lucky");
    assert.equal(row.surname, "");
    assert.ok(row.errors.some((e) => e.code === "NAME_MISSING_SURNAME"));
    assert.match(row.errors.find((e) => e.code === "NAME_MISSING_SURNAME")!.message, /Lucky/);
  });

  it("rejects a previously duplicated Lucky Lucky surname instead of loading it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "dup.csv");
    const values = [
      "460",
      "Lucky Lucky",
      "lucky2@example.com",
      "Mr",
      "Lucky Lucky",
      "South African ID",
      "9204015306086",
      "Grade 12",
      "0821234567",
      "1 Main Road",
      "2196",
      "Gauteng",
      "10 08 1996",
      "Friend Name",
      "0821234568",
      "Retail",
      "OPERATOR",
      "SKILLED WORKER",
      "Shop",
      "0111234567",
      "2 Work Ave",
      "2196",
      "Gauteng",
      "10 08 2024",
      "15000",
      "12000",
      "200",
      "300",
      "500",
      "Capitec",
      "Savings/Transactional",
      "Lucky Lucky",
      "0821234567",
      "",
      "",
    ];
    const csv = [HEADERS, values]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });
    const row = applicants[0]!;
    assert.equal(row.firstName, "Lucky");
    assert.equal(row.surname, "");
    assert.ok(row.errors.some((e) => e.code === "NAME_MISSING_SURNAME"));
    assert.match(
      row.errors.find((e) => e.code === "NAME_MISSING_SURNAME")!.message,
      /duplicated/i
    );
  });

  it("blocks Married rows that are missing spouse ID or marital date", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "married.csv");
    const headers = [
      ...HEADERS.slice(0, 18),
      "Marital status",
      "Spouse Name + Surname",
      "Spouse number",
      ...HEADERS.slice(18),
    ];
    const values = [
      "350",
      "Hendrik Sylvester Tobias",
      "hendrik@example.com",
      "Mr",
      "Hendrik Sylvester Tobias",
      "South African ID",
      "8606045216088",
      "Grade 12",
      "0821234567",
      "1 Main Road",
      "2196",
      "Gauteng",
      "10 08 2020",
      "Friend Name",
      "0821234568",
      "Retail",
      "Clerk",
      "Staff",
      "Married",
      "Frieda Tobias",
      "0786454285",
      "Shop",
      "0111234567",
      "2 Work Ave",
      "2196",
      "Gauteng",
      "04 08 2025",
      "10000",
      "8000",
      "200",
      "300",
      "500",
      "Capitec",
      "Savings/Transactional",
      "Hendrik Sylvester Tobias",
      "0821234567",
      "",
      "",
    ];
    const csv = [headers, values]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });
    const row = applicants[0]!;
    assert.equal(row.maritalStatus, "Married");
    assert.equal(row.spouseFullName, "Frieda Tobias");
    assert.equal(row.spousePhone, "0786454285");
    assert.equal(row.maritalDate, undefined);
    // Seriti requires Spouse ID and Marital date for Married — do not copy residency.
    assert.ok(row.errors.some((e) => e.code === "SPOUSE_ID_EMPTY"));
    assert.ok(row.errors.some((e) => e.code === "MARITAL_DATE_EMPTY"));
  });

  it("rejects a row when next-of-kin phone is blank", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "row.csv");
    const values = [
      "55",
      "Mothoka Jefferson Oupa Sekhwela",
      "sekhwelaoupa83@gmail.com",
      "Mr",
      "Mothoka Jefferson Oupa Sekhwela",
      "South African ID",
      "8304015345083",
      "Grade 12",
      "0629095338",
      "1528 Park Town, Church Street, Kgapane",
      "830",
      "Limpopo",
      "01 10 1986",
      "David Moraba",
      "",
      "Legal Services / Law Enforcement",
      "Deputy Sheriff",
      "Mid-Level",
      "Sheriff Musina",
      "0155342200",
      "112 Irwin Street, Musina",
      "900",
      "Limpopo",
      "12 10 2022",
      "15000",
      "12000",
      "1000",
      "500",
      "2000",
      "Capitec",
      "Savings/Transactional",
      "Mothoka Jefferson Oupa Sekhwela",
      "0629095338",
      "",
      "",
    ];
    const csv = [HEADERS, values]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });

    const row = applicants[0]!;
    assert.equal(row.nextOfKinPhone, "");
    const nok = row.errors.find((e) => e.field === "nextOfKinPhone");
    assert.ok(nok);
    assert.equal(nok!.code, "NOK_PHONE_EMPTY");
    assert.match(nok!.message, /Next of kin cellphone number/);
  });

  it("does not reject a row when next-of-kin phone is a 9-digit typo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "nok-typo.csv");
    const values = [
      "55",
      "Mothoka Jefferson Oupa Sekhwela",
      "sekhwelaoupa83@gmail.com",
      "Mr",
      "Mothoka Jefferson Oupa Sekhwela",
      "South African ID",
      "8304015345083",
      "Grade 12",
      "0629095338",
      "1528 Park Town, Church Street, Kgapane",
      "830",
      "Limpopo",
      "01 10 1986",
      "David Moraba",
      "076997746",
      "Legal Services / Law Enforcement",
      "Deputy Sheriff",
      "Mid-Level",
      "Sheriff Musina",
      "0155342200",
      "112 Irwin Street, Musina",
      "900",
      "Limpopo",
      "12 10 2022",
      "15000",
      "12000",
      "1000",
      "500",
      "2000",
      "Capitec",
      "Savings/Transactional",
      "Mothoka Jefferson Oupa Sekhwela",
      "0629095338",
      "",
      "",
    ];
    const csv = [HEADERS, values]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });

    const row = applicants[0]!;
    assert.equal(row.nextOfKinPhone, "");
    assert.ok(!row.errors.some((e) => e.field === "nextOfKinPhone"));
  });

  it("copies residential address onto employer address only when occupation is self-employed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "self.csv");
    const headers = [
      ...HEADERS.slice(0, 23),
      "Marital status",
      "Next of kin relationship",
      "Max price range",
      ...HEADERS.slice(23),
    ];
    const employed = [
      "55",
      "Ada Lovelace",
      "ada@example.com",
      "Ms",
      "Ada Lovelace",
      "South African ID",
      "8705135782080",
      "Grade 12",
      "0821234567",
      "12 Main Road Pretoria",
      "0083",
      "Gauteng",
      "10 05 2023",
      "Vusi Nel",
      "0856475124",
      "RETAIL",
      "CLERK",
      "SKILLED WORKER",
      "Test Shop",
      "0111234567",
      "",
      "",
      "",
      "Single",
      "Friend",
      "350000",
      "10 05 2024",
      "15000",
      "12000",
      "300",
      "500",
      "2000",
      "Capitec",
      "Savings/Transactional",
      "Ada Lovelace",
      "0821234567",
      "",
      "",
    ];
    const selfEmployed = employed.slice();
    selfEmployed[15] = "RETAIL";
    selfEmployed[16] = "Self-employed";
    const csv = [headers, employed, selfEmployed]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });
    assert.equal(applicants.length, 2);
    const employedRow = applicants[0]!;
    const selfRow = applicants[1]!;

    assert.equal(employedRow.employerAddress, "");
    assert.ok(
      employedRow.errors.some(
        (e) => e.code === "EMPLOYER_ADDRESS_EMPTY" && /Employer street address/.test(e.message)
      )
    );
    assert.equal(employedRow.industry, "RETAIL");
    assert.equal(employedRow.occupation, "CLERK");
    assert.notEqual(employedRow.employerProvince, employedRow.province);

    assert.equal(selfRow.industry, "BUSINESS SERVICES");
    assert.equal(selfRow.occupation, "SELF EMPLOYED (NON PROFESSIONAL)");
    assert.equal(selfRow.employerAddress, "12 Main Road Pretoria");
    assert.equal(selfRow.employerPostalCode, "0083");
    assert.equal(selfRow.employerProvince, "Gauteng");
    assert.ok(!selfRow.errors.some((e) => e.code === "EMPLOYER_ADDRESS_EMPTY"));
    assert.ok(!selfRow.errors.some((e) => e.code === "EMPLOYER_POSTAL_EMPTY"));
    assert.ok(!selfRow.errors.some((e) => e.code === "EMPLOYER_PROVINCE_EMPTY"));
  });

  it("remaps sheet Occupation LABOURER (SKILLED) to OPERATOR at load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "labourer-default.csv");
    const headers = [
      ...HEADERS.slice(0, 23),
      "Marital status",
      "Next of kin relationship",
      "Max price range",
      ...HEADERS.slice(23),
    ];
    const values = [
      "55",
      "Ada Lovelace",
      "ada@example.com",
      "Ms",
      "Ada Lovelace",
      "South African ID",
      "8705135782080",
      "Grade 12",
      "0821234567",
      "12 Main Road Pretoria",
      "0083",
      "Gauteng",
      "10 05 2023",
      "Vusi Nel",
      "0856475124",
      "RETAIL",
      "LABOURER (SKILLED)",
      "SKILLED WORKER",
      "Test Shop",
      "0111234567",
      "1 Work Ave",
      "0083",
      "Gauteng",
      "Single",
      "Friend",
      "350000",
      "10 05 2024",
      "15000",
      "12000",
      "300",
      "500",
      "2000",
      "Capitec",
      "Savings/Transactional",
      "Ada Lovelace",
      "0821234567",
      "",
      "",
    ];
    const csv = [headers, values]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });
    assert.equal(applicants[0]!.occupation, "OPERATOR");
    assert.ok(!applicants[0]!.errors.some((e) => e.field === "occupation"));
  });

  it("blocks loads below R12000 nett and implausible high salaries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "salary.csv");
    const headers = [
      ...HEADERS.slice(0, 23),
      "Marital status",
      "Next of kin relationship",
      "Max price range",
      ...HEADERS.slice(23),
    ];
    const base = [
      "55",
      "Ada Lovelace",
      "ada@example.com",
      "Ms",
      "Ada Lovelace",
      "South African ID",
      "8705135782080",
      "Grade 12",
      "0821234567",
      "12 Main Road Pretoria",
      "0083",
      "Gauteng",
      "10 05 2023",
      "Vusi Nel",
      "0856475124",
      "RETAIL",
      "CLERK",
      "SKILLED WORKER",
      "Test Shop",
      "0111234567",
      "1 Work Ave",
      "0083",
      "Gauteng",
      "Single",
      "Friend",
      "350000",
      "10 05 2024",
      "15000",
      "11000",
      "300",
      "500",
      "2000",
      "Capitec",
      "Savings/Transactional",
      "Ada Lovelace",
      "0821234567",
      "",
      "",
    ];
    const typo = base.slice();
    typo[1] = "Typo Client";
    typo[2] = "typo@example.com";
    typo[4] = "Typo Client";
    typo[6] = "8606045216088";
    typo[27] = "R1000000";
    typo[28] = "R800000";
    const csv = [headers, base, typo]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });
    assert.equal(applicants.length, 2);
    const affordability = applicants[0]!.errors.find((e) => e.code === "AFFORDABILITY_ERROR");
    assert.ok(affordability);
    assert.equal(affordability!.field, "nettSalary");
    assert.match(affordability!.message, /Nett salary R11000/);
    assert.ok(applicants[1]!.errors.some((e) => e.code === "SALARY_IMPLAUSIBLE"));
    assert.equal(applicants[1]!.grossMonthly, "1000000");
  });

  it("flags an empty extra automation column by name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hatfield-sheet-"));
    const csvPath = join(dir, "blank-id-type.csv");
    const headers = [...HEADERS];
    const values = [
      "55",
      "Ada Lovelace",
      "ada@example.com",
      "Ms",
      "",
      "",
      "8705135782080",
      "Grade 12",
      "0821234567",
      "12 Main Road Pretoria",
      "0083",
      "Gauteng",
      "10 05 2023",
      "Vusi Nel",
      "0856475124",
      "RETAIL",
      "CLERK",
      "SKILLED WORKER",
      "Test Shop",
      "0111234567",
      "1 Work Ave",
      "0083",
      "Gauteng",
      "10 05 2024",
      "15000",
      "12000",
      "300",
      "500",
      "2000",
      "Capitec",
      "Savings/Transactional",
      "Ada Lovelace",
      "0821234567",
      "",
      "",
    ];
    const csv = [headers, values]
      .map((cols) => cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    writeFileSync(csvPath, csv);

    const applicants = await fetchSheetData({
      csvUrl: "",
      mapping: loadColumnMapping("./mapping.json"),
      localCsvPath: csvPath,
      includeCompleted: true,
    });
    const row = applicants[0]!;
    const missing = row.errors.filter((e) => e.code === "COLUMN_EMPTY").map((e) => e.field);
    assert.ok(missing.includes("First names + surname"));
    assert.ok(missing.includes("ID Type"));
    assert.ok(row.errors.every((e) => e.field !== "Status" && e.field !== "Timing"));
  });
});
