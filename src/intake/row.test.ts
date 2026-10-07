import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadIntakeMapping } from "./mapping.js";
import { accountTypeForBank, buildOutputValues, normalizeEmail } from "./row.js";

const mapping = loadIntakeMapping("./config/intake-mapping.yaml");

const intakeAda = {
  "Name and surname": "Ada Lovelace",
  "Email address": "ada@example.com",
  Gender: "Female",
  "Highest education": "Grade 12",
  "ID Number": "8001015800084",
  "Whatsapp Phone number": "0821234567",
  "Current STREET address and House number Example: 1058 Steve Biko Road": "12 Main Road",
  Province: "Gauteng",
  "City/Town Example: Pretoria/Cape Town/ Kimberley": "Pretoria",
  "Relative or friend Name Example: Vusi": "Vusi",
  "Relative or friend surname Example: Nel": "Nel",
  "Relative or friend number example: 0856475124 CANNOT BE THE SAME AS YOURS": "0856475124",
  "Name of Company you work for?": "Test Shop",
  "Job title?": "Clerk",
  "Gross Income per month (Income on your payslip before any payslip deductions)": "15000",
  "Net Income per month? (Income paid into your account by your employer)": "12000",
  "Which bank do you use?": "Capitec",
  "How long have you lived here? Example: 3 years/ 2 months": "3 years",
  "How long have you been working here? Example: 2 Years /6 Months": "2 years",
  "Marital Status": "Single",
  "Food spend": "2000",
  "Cellphone spend": "300",
  "Accounts spend": "500",
  Employment: "Permanently Employed with payslips",
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
    assert.equal(values.Occupation, "CLERK");
    assert.equal(values["Industry (AI based on employer)"], "RETAIL");
    assert.equal(values["Address line"], "12 Main Road Pretoria");
    assert.equal(values["Next of kin name + Surname"], "Vusi Nel");
    assert.equal(values["Next of kin relationship"], "Friend");
    assert.equal(values["Food cost"], "2000");
    assert.equal(values["Telephone payment"], "300");
    assert.equal(values["Transport cost"], "500");
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

  it("maps free-text Industry/Level onto Seriti menus and falls back Occupation", () => {
    const values = buildOutputValues(
      mapping,
      {
        "Industry (AI based on employer)": "Consulting",
        "Employee level": "Manager",
      },
      { ...intakeAda, "Job title?": "Warehouse picker" },
      new Date(2026, 9, 5)
    );
    assert.equal(values["Industry (AI based on employer)"], "BUSINESS SERVICES");
    assert.equal(values["Employee level"], "MANAGEMENT");
    assert.equal(values.Occupation, "LABOURER (SKILLED)");
  });

  it("forces BUSINESS SERVICES for self-employed Employment answers", () => {
    const values = buildOutputValues(
      mapping,
      { "Industry (AI based on employer)": "Retail" },
      { ...intakeAda, Employment: "Self-employed" },
      new Date(2026, 9, 5)
    );
    assert.equal(values["Industry (AI based on employer)"], "BUSINESS SERVICES");
  });

  it("does not copy the home address into employer fields or invent expense zeros from Unknown", () => {
    const values = buildOutputValues(
      mapping,
      {
        "Employer street address (online search)": "",
        "Telephone payment": "Unknown",
      },
      {
        ...intakeAda,
        "Food spend": "",
        "Cellphone spend": "",
        "Accounts spend": "",
      }
    );
    assert.equal(values["Employer street address (online search)"], "");
    assert.equal(values["Telephone payment"], "");
    assert.equal(values["Transport cost"], "0");
    assert.match(values["Address line"], /12 Main Road/);
  });

  it("uses city/town as the postal place needle when Gemini leaves postal empty", () => {
    const values = buildOutputValues(mapping, { "Postal code": "" }, intakeAda);
    assert.equal(values["Postal code"], "Pretoria");
  });

  it("repairs a doubled email domain", () => {
    assert.equal(normalizeEmail("ada@gmail.com@gmail.com"), "ada@gmail.com");
  });
});
