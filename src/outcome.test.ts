import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyRuntimeError,
  durationSeconds,
  formatDataErrorCell,
  formatErrorCell,
  formatRuntimeErrorCell,
  humanizeErrorCode,
  isStatusPopulated,
  successfulReferenceFromCell,
} from "./outcome.js";
import { splitNextOfKinName } from "./transforms.js";

describe("formatErrorCell", () => {
  it("writes a human reason instead of raw codes", () => {
    assert.equal(formatErrorCell(["ID_NOT_13_DIGITS"]), "ERROR: Id not 13 digits.");
    assert.equal(formatErrorCell(["EMAIL_EMPTY"]), "ERROR: Email empty.");
  });

  it("falls back when no codes are provided", () => {
    assert.equal(formatErrorCell([]), "ERROR: Submit failed.");
  });
});

describe("formatDataErrorCell", () => {
  it("writes only the first human reason", () => {
    assert.equal(
      formatDataErrorCell([
        { code: "NEXT_OF_KIN_MISSING_SURNAME", message: "Next of kin surname missing" },
        { code: "EMAIL_EMPTY", message: "Email missing" },
      ]),
      "ERROR: Next of kin surname missing."
    );
  });

  it("humanizes a code when message is absent", () => {
    assert.equal(
      formatDataErrorCell([{ code: "TRANSPORT_EXPENSE_EMPTY" }]),
      "ERROR: Transport expense empty."
    );
  });
});

describe("humanizeErrorCode", () => {
  it("turns underscores into words", () => {
    assert.equal(humanizeErrorCode("RESIDENCY_DATE_EMPTY"), "Residency date empty");
  });
});

describe("successfulReferenceFromCell", () => {
  it("accepts a live reference and ignores error cells", () => {
    assert.equal(successfulReferenceFromCell("ZAHTVW0013281422"), "ZAHTVW0013281422");
    assert.equal(successfulReferenceFromCell("error ID_NOT_13_DIGITS"), undefined);
    assert.equal(successfulReferenceFromCell("ERROR: Next of kin surname missing."), undefined);
    assert.equal(successfulReferenceFromCell(""), undefined);
  });
});

describe("isStatusPopulated", () => {
  it("treats any non-empty Status cell as already handled", () => {
    assert.equal(isStatusPopulated("ZAHTVW0013281422"), true);
    assert.equal(isStatusPopulated("ERROR: Transport expense missing."), true);
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
    assert.equal(
      classifyRuntimeError('No option matching "Bank Zero" in Bank. Available: CAPITEC | FNB', 5),
      "DROPDOWN_OPTION_MISSING"
    );
    assert.equal(
      classifyRuntimeError("Work & Salary Next did not open the next page. Waiting for [id=\"ddlBank\"]", 4),
      "WORK_NEXT_FAILED"
    );
  });
});

describe("formatRuntimeErrorCell", () => {
  it("writes ERROR with a human hint (no code dump)", () => {
    const cell = formatRuntimeErrorCell(
      'No option matching "Bank Zero" in Bank. Available: CAPITEC BANK LIMITED | FIRSTRAND BANK LIMITED',
      5
    );
    assert.match(cell, /^ERROR: /);
    assert.match(cell, /Bank "Bank Zero"/);
    assert.doesNotMatch(cell, /DROPDOWN_OPTION_MISSING/);
  });

  it("explains WORK_NEXT_FAILED is not a telephone/bank cell problem", () => {
    const cell = formatRuntimeErrorCell(
      'waiting for locator(\'[id="txtTelephonePayment"], [id="ddlBank"]\')',
      4
    );
    assert.match(cell, /^ERROR: /);
    assert.match(cell, /Not telephone\/bank/);
  });
});

describe("splitNextOfKinName status wording", () => {
  it("says surname missing when only a given name is present", () => {
    const parsed = splitNextOfKinName("Thabo");
    assert.equal(parsed.valid, false);
    assert.equal(parsed.message, "Next of kin surname missing");
  });
});

describe("durationSeconds", () => {
  it("rounds to one decimal second", () => {
    assert.equal(durationSeconds(0, 40123), 40.1);
    assert.equal(durationSeconds(1000, 1000), 0);
  });
});
