import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEnvValue } from "./config.js";

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
