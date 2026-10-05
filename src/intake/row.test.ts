import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadIntakeMapping } from "./mapping.js";
import { accountTypeForBank, buildOutputValues } from "./row.js";

const mapping = loadIntakeMapping("./config/intake-mapping.yaml");

const intakeAda = {
  "Name and surname": "Ada Lovelace",
  "Email address": "ada@example.com",
  Gender: "Female",
  "Highest education": "Grade 12",
  "ID Number": "8001015800084",
  "Whatsapp Phone number": "0821234567",
  "Current street address Example: 1058 Steve Biko Road": "12 Main Road",
  Province: "Gauteng",
  "Relative or friend Name & surname Example: Vusi Nel": "Vusi Nel",
  "Relative or friend number example: 0856475124": "0856475124",
  "Name of Company you work for?": "Test Shop",
  "Job title?": "Clerk",
  "Gross Income per month (Income on your payslip before any payslip deductions)": "15000",
  "Net Income per month? (Income paid into your account by your employer)": "12000",
  "Which bank do you use?": "Capitec",
  "How long have you lived here? Example: 3 years/ 2 months": "3 years",
  "How long have you been working here? Example: 2 Years /6 Months": "2 years",
};

describe("output row contract", () => {
  it("maps Capitec to Savings/Transactional", () => {
    assert.equal(accountTypeForBank("Capitec"), "Savings/Transactional");
    assert.equal(accountTypeForBank("FNB"), "Cheque/Current");
  });

  it("copies Form fields in code and ignores Gemini name rewrites", () => {
    const values = buildOutputValues(
      mapping,
      {
        "Full name": "Ada L",
        "First names + surname": "Ada L",
        Title: "Mr",
        Occupation: "Invented job",
        "Industry (AI based on employer)": "Retail",
        "Employee level": "Staff",
        "Postal code": "2196",
        "Employer telephone number (online search)": "0111234567",
        "Employer street address (online search)": "1 Work Ave",
        "Employer postal code (online search)": "2196",
        "Employer province (online search)": "Gauteng",
        "Telephone payment": "200",
        "Transport cost": "500",
        "Food cost": "2000",
      },
      intakeAda,
      new Date(2026, 9, 5)
    );

    assert.equal(values["Full name"], "Ada Lovelace");
    assert.equal(values["First names + surname"], "Ada Lovelace");
    assert.equal(values.Title, "Ms");
    assert.equal(values.Occupation, "Clerk");
    assert.equal(values["Industry (AI based on employer)"], "Retail");
    assert.equal(values.Status, "");
    assert.equal(values.Timing, "");
    assert.equal(values["ID Type"], "RSA ID");
    assert.equal(values["Client cellphone number (add again at the end)"], "0821234567");
    assert.equal(values["Account type (AI—most likely option based on bank)"], "Savings/Transactional");
    assert.equal(values["Account holder name and surname (same as client)"], "Ada Lovelace");
    assert.equal(values["Year start living at address (MM DD YYYY format ONLY)"], "10 05 2023");
    assert.equal(values.NR, undefined);
    assert.equal(mapping.destination_columns.length, 38);
  });

  it("does not copy the home address into employer fields or invent expense zeros", () => {
    const values = buildOutputValues(
      mapping,
      {
        "Employer street address (online search)": "",
        "Telephone payment": "Unknown",
      },
      intakeAda
    );
    assert.equal(values["Employer street address (online search)"], "");
    assert.equal(values["Telephone payment"], "");
    assert.equal(values["Address line"], "12 Main Road");
  });
});
