import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandSelectNeedles, formatDateForForm, postalSearchNeedles, restorePostalCode, splitNextOfKinName, valuesMatch } from "./transforms.js";

describe("expandSelectNeedles", () => {
  it("maps FNB to Firstrand search terms", () => {
    assert.deepEqual(expandSelectNeedles("FNB"), ["FNB", "FIRSTRAND", "FIRST NATIONAL"]);
  });

  it("maps Standardbank (one word) to Standard Bank search terms", () => {
    const terms = expandSelectNeedles("Standardbank").map((t) => t.toLowerCase());
    assert.ok(terms.includes("standard bank"));
    assert.ok(terms.includes("standard"));
  });

  it("maps Cheque/Current to current then cheque", () => {
    const terms = expandSelectNeedles("Cheque/Current").map((t) => t.toLowerCase());
    assert.ok(terms.includes("current"));
    assert.ok(terms.includes("cheque"));
  });

  it("maps Savings/Transactional to savings", () => {
    const terms = expandSelectNeedles("Savings/Transactional").map((t) => t.toLowerCase());
    assert.ok(terms.includes("savings"));
  });
});

describe("valuesMatch bank aliases", () => {
  it("treats FNB as matching FIRSTRAND BANK LIMITED", () => {
    assert.equal(valuesMatch("FNB", "FIRSTRAND BANK LIMITED"), true);
  });

  it("treats Capitec as matching CAPITEC BANK LIMITED", () => {
    assert.equal(valuesMatch("Capitec", "CAPITEC BANK LIMITED"), true);
  });
});

describe("splitNextOfKinName", () => {
  it("duplicates a single given name as the surname", () => {
    assert.deepEqual(splitNextOfKinName("Phuluso"), {
      firstName: "Phuluso",
      surname: "Phuluso",
      valid: true,
    });
  });

  it("still splits a two-word next of kin name", () => {
    assert.deepEqual(splitNextOfKinName("Phuluso Nevombe"), {
      firstName: "Phuluso",
      surname: "Nevombe",
      valid: true,
    });
  });

  it("still rejects an empty next of kin name", () => {
    assert.equal(splitNextOfKinName("").valid, false);
    assert.equal(splitNextOfKinName("").code, "NEXT_OF_KIN_EMPTY");
  });
});

describe("restorePostalCode", () => {
  it("pads a 3-digit Sheets-stripped code to 4 digits", () => {
    assert.equal(restorePostalCode("300"), "0300");
    assert.equal(restorePostalCode(300), "0300");
  });

  it("leaves a 4-digit code unchanged", () => {
    assert.equal(restorePostalCode("1685"), "1685");
  });
});

describe("formatDateForForm", () => {
  it("converts MM DD YYYY sheet dates to DD Mon YYYY", () => {
    assert.equal(formatDateForForm("08 18 2011"), "18 Aug 2011");
    assert.equal(formatDateForForm("02 18 2015"), "18 Feb 2015");
  });
});

describe("postalSearchNeedles", () => {
  it("uses place names for military-base addresses instead of 'base'", () => {
    const addr = "SAMHS training formation Thaba Tshwane military base";
    const needles = postalSearchNeedles("143", addr, "Gauteng");
    assert.ok(needles.includes("0143"));
    assert.ok(needles.includes("0143 Tshwane"));
    assert.ok(!needles.includes("base"));
    assert.ok(!needles.includes("0143 base"));
  });

  it("still extracts town before a trailing postal code in the address", () => {
    const needles = postalSearchNeedles("7580", "18 sunridge street wesbank kuilsriver 7580", "Western Cape");
    assert.ok(needles.some((n) => /7580/i.test(n) && /kuilsriver/i.test(n)));
  });
});
