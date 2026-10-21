import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatErrorCell } from "./outcome.js";
import {
  errorCodesFromStatus,
  isRepairableAutomationStatus,
  maritalDateEmptyStatusExample,
  shouldClearRepairedStatus,
} from "./repairableStatus.js";

describe("errorCodesFromStatus", () => {
  it("reads loader formatDataErrorCell messages", () => {
    const cell = maritalDateEmptyStatusExample();
    assert.match(cell, /^error MARITAL_DATE_EMPTY:/);
    assert.deepEqual(errorCodesFromStatus(cell), ["MARITAL_DATE_EMPTY"]);
  });

  it("reads comma-joined formatErrorCell codes", () => {
    assert.deepEqual(errorCodesFromStatus(formatErrorCell(["MARITAL_DATE_EMPTY", "SPOUSE_ID_EMPTY"])), [
      "MARITAL_DATE_EMPTY",
      "SPOUSE_ID_EMPTY",
    ]);
  });
});

describe("isRepairableAutomationStatus", () => {
  it("accepts blank Status and recoverable Form-copy errors", () => {
    assert.equal(isRepairableAutomationStatus(""), true);
    assert.equal(isRepairableAutomationStatus("   "), true);
    assert.equal(isRepairableAutomationStatus(maritalDateEmptyStatusExample()), true);
    assert.equal(isRepairableAutomationStatus("error SPOUSE_ID_EMPTY"), true);
    assert.equal(
      isRepairableAutomationStatus("error MARITAL_DATE_EMPTY, SPOUSE_ID_EMPTY"),
      true
    );
  });

  it("rejects loaded refs and unrecoverable client errors", () => {
    assert.equal(isRepairableAutomationStatus("ZAHTVW0013281422"), false);
    assert.equal(isRepairableAutomationStatus("error ID_CHECKSUM_INVALID"), false);
    assert.equal(isRepairableAutomationStatus("error AFFORDABILITY_ERROR"), false);
    assert.equal(
      isRepairableAutomationStatus("error MARITAL_DATE_EMPTY, ID_CHECKSUM_INVALID"),
      false
    );
  });
});

describe("shouldClearRepairedStatus", () => {
  it("clears MARITAL_DATE_EMPTY only after a valid MM DD YYYY date is on the row", () => {
    const status = maritalDateEmptyStatusExample();
    assert.equal(shouldClearRepairedStatus(status, { "Marital date": "" }), false);
    assert.equal(shouldClearRepairedStatus(status, { "Marital date": "01/03/2024" }), true);
    assert.equal(shouldClearRepairedStatus(status, { "Marital date": "03 01 2024" }), true);
    assert.equal(shouldClearRepairedStatus("", { "Marital date": "03 01 2024" }), false);
  });

  it("clears SPOUSE_ID_EMPTY only for a valid RSA ID, not a 10-digit phone", () => {
    const status = "error SPOUSE_ID_EMPTY";
    assert.equal(
      shouldClearRepairedStatus(status, { "Spouse ID number": "0786454285" }),
      false
    );
    assert.equal(
      shouldClearRepairedStatus(status, { "Spouse ID number": "8705135782080" }),
      true
    );
  });
});
