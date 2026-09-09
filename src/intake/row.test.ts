import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadIntakeMapping } from "./mapping.js";
import { accountTypeForBank, buildOutputValues } from "./row.js";

describe("output row contract", () => {
  it("maps Capitec to Savings/Transactional", () => {
    assert.equal(accountTypeForBank("Capitec"), "Savings/Transactional");
    assert.equal(accountTypeForBank("FNB"), "Cheque/Current");
  });

  it("emits Status and Timing blank and copies the cellphone twice", () => {
    const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
    const values = buildOutputValues(mapping, {
      "Full name": "Ada Lovelace",
      Email: "ada@example.com",
      Title: "Ms",
      "First names + surname": "Ada Lovelace",
      "ID Type": "South African ID",
      "ID number": "8001015800084",
      "Educational level": "Grade 12",
      "Mobile number": "0821234567",
      "Address line": "12 Main Road",
      "Postal code": "2196",
      Province: "Gauteng",
      "Year start living at address (MM DD YYYY format ONLY)": "01 01 2020",
      "Next of kin name + Surname": "Vusi Nel",
      "Next of kin cellphone number": "0856475124",
      "Industry (AI based on employer)": "Retail",
      Occupation: "Clerk",
      "Employee level": "Staff",
      "Employer name": "Test Shop",
      "Employer telephone number (online search)": "0111234567",
      "Employer street address (online search)": "1 Work Ave",
      "Employer postal code (online search)": "2196",
      "Employer province (online search)": "Gauteng",
      "Year they started working there (calculate from years provided)": "01 06 2022",
      "Gross monthly salary": "15000",
      "Nett salary": "12000",
      "Telephone payment": "200",
      "Transport cost": "500",
      "Food cost": "2000",
      "Bank name": "Capitec",
      "Account type (AI—most likely option based on bank)": "",
      "Account holder name and surname (same as client)": "",
      "Client cellphone number (add again at the end)": "",
    });

    assert.equal(values.Status, "");
    assert.equal(values.Timing, "");
    assert.equal(values["Client cellphone number (add again at the end)"], "0821234567");
    assert.equal(values["Account type (AI—most likely option based on bank)"], "Savings/Transactional");
    assert.equal(values["Account holder name and surname (same as client)"], "Ada Lovelace");
    assert.equal(values.NR, undefined);
    assert.equal(mapping.destination_columns.length, 35);
  });
});
