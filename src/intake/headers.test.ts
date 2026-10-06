import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cell, displayHeader, flattenRow, hasConsent, normalizeHeader } from "./headers.js";

describe("intake headers", () => {
  it("matches Form titles that contain newlines or extra example text", () => {
    const row = {
      "Highest education \n": "Grade 12",
      "Current STREET address and House number\nExample: 1058 Steve Biko Road": "12 Main Road",
    };
    assert.equal(cell(row, "Highest education"), "Grade 12");
    assert.equal(
      cell(row, "Current STREET address and House number Example: 1058 Steve Biko Road"),
      "12 Main Road"
    );
    assert.equal(normalizeHeader("Highest education \n"), "highest education");
  });

  it("flattens rows without breaking multi-line Form headers", () => {
    const text = flattenRow({
      "Highest education \n": "Grade 12",
      "Name and surname": "Ada Lovelace",
    });
    assert.match(text, /^Highest education: Grade 12$/m);
    assert.match(text, /^Name and surname: Ada Lovelace$/m);
    assert.equal(displayHeader("Highest education \n"), "Highest education");
  });

  it("treats Yes as consent and No as declined", () => {
    assert.equal(hasConsent("Yes"), true);
    assert.equal(hasConsent("I agree"), true);
    assert.equal(hasConsent("No"), false);
    assert.equal(hasConsent(""), false);
  });
});
