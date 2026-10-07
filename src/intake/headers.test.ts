import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cell, coreHeader, hasConsent, joinFilled, normalizeHeader } from "./headers.js";

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

  it("matches the live STREET / House number Form title against the mapped header", () => {
    const row = {
      "Current STREET address and House number Example: 1058 Steve Biko Road": "12 Main Road",
    };
    assert.equal(
      cell(row, "Current STREET address and House number Example: 1058 Steve Biko Road"),
      "12 Main Road"
    );
    // Older config title should still resolve via core-token matching
    assert.equal(
      cell(row, "Current street address Example: 1058 Steve Biko Road"),
      "12 Main Road"
    );
    assert.match(coreHeader(Object.keys(row)[0]!), /street address/);
  });

  it("joins split next-of-kin name and surname columns", () => {
    const row = {
      "Relative or friend Name Example: Vusi": "Vusi",
      "Relative or friend surname Example: Nel": "Nel",
    };
    assert.equal(
      joinFilled(row, [
        "Relative or friend Name Example: Vusi",
        "Relative or friend surname Example: Nel",
      ]),
      "Vusi Nel"
    );
  });

  it("treats Yes as consent and No as declined", () => {
    assert.equal(hasConsent("Yes"), true);
    assert.equal(hasConsent("I agree"), true);
    assert.equal(hasConsent("No"), false);
    assert.equal(hasConsent(""), false);
  });
});
