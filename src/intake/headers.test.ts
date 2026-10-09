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
      ["Name and surname", "Email address"],
      ["Name and surname", "Current STREET address and House number Example: 1058 Steve Biko Road"]
    );
    assert.equal(missing.length, 1);
    assert.match(missing[0]!, /STREET address/i);
    assert.throws(() =>
      assertIntakeHeadersPresent(["Name and surname"], ["Name and surname", "ID Number"])
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
});
