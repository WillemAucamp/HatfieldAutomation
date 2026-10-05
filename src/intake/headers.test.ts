import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cell, hasConsent, normalizeHeader } from "./headers.js";

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

  it("treats Yes as consent and No as declined", () => {
    assert.equal(hasConsent("Yes"), true);
    assert.equal(hasConsent("I agree"), true);
    assert.equal(hasConsent("No"), false);
    assert.equal(hasConsent(""), false);
  });
});
