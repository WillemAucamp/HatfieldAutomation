import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyRuntimeError,
  durationSeconds,
  formatErrorCell,
  isStatusPopulated,
  successfulReferenceFromCell,
} from "./outcome.js";

describe("formatErrorCell", () => {
  it("prefixes error and joins codes", () => {
    assert.equal(formatErrorCell(["ID_NOT_13_DIGITS"]), "error ID_NOT_13_DIGITS");
    assert.equal(
      formatErrorCell(["ID_NOT_13_DIGITS", "EMAIL_EMPTY"]),
      "error ID_NOT_13_DIGITS, EMAIL_EMPTY"
    );
  });

  it("falls back when no codes are provided", () => {
    assert.equal(formatErrorCell([]), "error SUBMIT_FAILED");
  });
});

describe("successfulReferenceFromCell", () => {
  it("accepts a live reference and ignores error cells", () => {
    assert.equal(successfulReferenceFromCell("ZAHTVW0013281422"), "ZAHTVW0013281422");
    assert.equal(successfulReferenceFromCell("error ID_NOT_13_DIGITS"), undefined);
    assert.equal(successfulReferenceFromCell(""), undefined);
  });
});

describe("isStatusPopulated", () => {
  it("treats any non-empty Status cell as already handled", () => {
    assert.equal(isStatusPopulated("ZAHTVW0013281422"), true);
    assert.equal(isStatusPopulated("error ID_NOT_13_DIGITS"), true);
    assert.equal(isStatusPopulated(""), false);
    assert.equal(isStatusPopulated("   "), false);
  });
});

describe("classifyRuntimeError", () => {
  it("maps known timeouts to stable codes", () => {
    assert.equal(
      classifyRuntimeError('waiting for locator(\'[id="txtemployerName"], [id="ddlIndustry"]\')', 3),
      "PERSONAL_NEXT_FAILED"
    );
    assert.equal(
      classifyRuntimeError("Finish was clicked but no application reference number appeared", 6),
      "FINISH_NO_REFERENCE"
    );
    assert.equal(classifyRuntimeError("locator.waitFor: Timeout 20000ms exceeded", 4), "SECTION4_TIMEOUT");
  });
});

describe("durationSeconds", () => {
  it("rounds to one decimal second", () => {
    assert.equal(durationSeconds(0, 40123), 40.1);
    assert.equal(durationSeconds(1000, 1000), 0);
  });
});
