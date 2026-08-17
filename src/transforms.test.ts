import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandSelectNeedles, splitNextOfKinName, valuesMatch } from "./transforms.js";

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
