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
    // Blank marital + no spouse ⇒ Single (Form often omits marital).
    assert.equal(row.maritalStatus, "Single");
    assert.ok(!row.errors.some((e) => e.code === "MARITAL_STATUS_EMPTY"));
    assert.ok(row.errors.some((e) => e.code === "NOK_RELATIONSHIP_EMPTY"));
    // Max price is optional (Form does not ask). Empty must not block the row.
    assert.ok(!row.errors.some((e) => e.code === "MAX_PRICE_EMPTY"));
    assert.deepEqual(
      row.errors.filter((e) =>
        ["ID_EMPTY", "MOBILE_EMPTY", "TELEPHONE_EXPENSE_EMPTY", "MAX_PRICE_EMPTY"].includes(
          e.code
        )
      ),
      []
    );
  });

  it("duplicates a mononym as surname and does not hard-block", async () => {
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
      "10000",
      "8000",
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
    assert.equal(row.surname, "Lucky");
    assert.ok(!row.errors.some((e) => e.code === "NAME_MISSING_SURNAME"));
  });

  it("treats Married without spouse ID as loadable when marital date can fall back", async () => {
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
    assert.equal(row.maritalDate, "10 08 2020");
    assert.ok(!row.errors.some((e) => e.code === "SPOUSE_ID_EMPTY"));
    assert.ok(!row.errors.some((e) => e.code === "MARITAL_DATE_EMPTY"));
  });

  it("does not reject a row when next-of-kin phone is blank", async () => {
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

    const row = applicants[0]!;
    assert.equal(row.nextOfKinPhone, "");
    assert.ok(!row.errors.some((e) => e.field === "nextOfKinPhone"));
  });
});
