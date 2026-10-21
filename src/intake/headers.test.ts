import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertIntakeHeadersPresent,
  cell,
  hasConsent,
  joinFilled,
  missingIntakeHeaders,
  normalizeHeader,
} from "./headers.js";
import { joinPersonName } from "./name.js";

describe("intake headers", () => {
  it("matches Form titles that contain newlines or extra example text", () => {
    const row = {
      "Highest education \n": "Grade 12",
      "Current street address\nExample: 1058 Steve Biko Road": "12 Main Road",
    };
    assert.equal(cell(row, "Highest education"), "Grade 12");
    assert.equal(cell(row, "Current street address Example: 1058 Steve Biko Road"), "12 Main Road");
    assert.equal(normalizeHeader("Highest education \n"), "highest education");
  });

  it("matches the live STREET address header despite mapping wording drift", () => {
    const row = {
      "Current STREET address and House number\nExample: 1058 Steve Biko Road": "1058 Steve Biko Road",
    };
    assert.equal(
      cell(row, "Current STREET address and House number Example: 1058 Steve Biko Road"),
      "1058 Steve Biko Road"
    );
    assert.equal(
      cell(row, "Current street address Example: 1058 Steve Biko Road"),
      "1058 Steve Biko Road"
    );
  });

  it("joins given names and surname without duplicating the surname", () => {
    assert.equal(joinPersonName("Ada", "Lovelace"), "Ada Lovelace");
    assert.equal(joinPersonName("Ada Lovelace", "Lovelace"), "Ada Lovelace");
    assert.equal(joinPersonName("Ada Lovelace", ""), "Ada Lovelace");
    assert.equal(joinPersonName("Lucky", "Lucky"), "Lucky");
  });

  it("joins next-of-kin first name and surname columns", () => {
    const row = {
      "Relative or friend Name\nExample: Vusi": "Vusi",
      "Relative or friend surname\nExample: Nel": "Nel",
    };
    assert.equal(
      joinFilled(row, [
        "Relative or friend Name Example: Vusi",
        "Relative or friend surname Example: Nel",
      ]),
      "Vusi Nel"
    );
  });

  it("fails loudly when a required Form header is missing", () => {
    const missing = missingIntakeHeaders(
      ["First Name", "Surname", "Email address"],
      ["First Name", "Current STREET address and House number Example: 1058 Steve Biko Road"]
    );
    assert.equal(missing.length, 1);
    assert.match(missing[0]!, /STREET address/i);
    assert.throws(() =>
      assertIntakeHeadersPresent(["First Name"], ["First Name", "ID Number"])
    );
  });

  it("treats Yes as consent and No as declined", () => {
    assert.equal(hasConsent("Yes"), true);
    assert.equal(hasConsent("I agree"), true);
    assert.equal(hasConsent("No"), false);
    assert.equal(hasConsent(""), false);
  });

  it("matches the new intakes sheet debt-review and housing headers", () => {
    const row = {
      "Are you on Debt review or Credit bureau? ": "No",
      "Column 18": "Renting",
    };
    assert.equal(cell(row, "Are you on Debt review or Credit bureau?"), "No");
    assert.equal(cell(row, "Column 18"), "Renting");
  });

  it("does not treat applicant Name and surname as Spouse Name + Surname", () => {
    const row = {
      "Name and surname": "Ada Lovelace",
      "Spouse Name + Surname": "Frieda Tobias",
    };
    assert.equal(cell(row, "Spouse Name + Surname"), "Frieda Tobias");
    assert.equal(cell(row, "Name and surname"), "Ada Lovelace");
    assert.equal(cell({ "Name and surname": "Ada Lovelace" }, "Spouse Name + Surname"), "");
  });

  it("keeps First Name, Surname, and Spouse ID number distinct", () => {
    const row = {
      "First Name": "Ada",
      Surname: "Lovelace",
      "Relative or friend surname Example: Nel": "Nel",
      "Spouse ID number": "8705135782080",
      "ID Number": "8001015800084",
    };
    assert.equal(cell(row, "First Name"), "Ada");
    assert.equal(cell(row, "Surname"), "Lovelace");
    assert.equal(cell(row, "Spouse ID number"), "8705135782080");
    assert.equal(cell(row, "ID Number"), "8001015800084");
    assert.equal(cell(row, "Spouse number"), "");
    assert.equal(
      cell(
        { "Relative or friend surname Example: Nel": "Nel" },
        "Surname"
      ),
      ""
    );
  });
});
