import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEnvValue, parseMaxIntakeRows, parseRowFilter } from "./config.js";

describe("normalizeEnvValue", () => {
  it("strips NAME= prefix from pasted secrets", () => {
    const raw =
      "SHEET_WEBHOOK_URL=https://script.google.com/macros/s/abc123XYZ/exec";
    assert.equal(
      normalizeEnvValue(raw, "SHEET_WEBHOOK_URL"),
      "https://script.google.com/macros/s/abc123XYZ/exec"
    );
  });

  it("extracts embedded Apps Script exec URL", () => {
    const raw =
      'oops https://script.google.com/macros/s/abc123XYZ/exec trailing';
    assert.equal(
      normalizeEnvValue(raw, "SHEET_WEBHOOK_URL"),
      "https://script.google.com/macros/s/abc123XYZ/exec"
    );
  });

  it("strips wrapping quotes", () => {
    assert.equal(normalizeEnvValue('"hello"', "GEMINI_API_KEY"), "hello");
  });
});

describe("parseMaxIntakeRows", () => {
  it("treats empty as unlimited (0) by default", () => {
    assert.equal(parseMaxIntakeRows(undefined), 0);
    assert.equal(parseMaxIntakeRows(""), 0);
    assert.equal(parseMaxIntakeRows("  "), 0);
  });

  it("parses a positive cap", () => {
    assert.equal(parseMaxIntakeRows("5"), 5);
  });

  it("rejects negative / NaN and falls back", () => {
    assert.equal(parseMaxIntakeRows("-1", 3), 3);
    assert.equal(parseMaxIntakeRows("nope", 3), 3);
  });
});

describe("parseRowFilter", () => {
  it("drops row 0 from an Apps Script 302 and the header row", () => {
    assert.deepEqual(parseRowFilter("0,1,101,102"), [101, 102]);
  });

  it("treats blank as no filter", () => {
    assert.deepEqual(parseRowFilter(""), []);
    assert.deepEqual(parseRowFilter(undefined), []);
  });
});
