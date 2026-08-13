import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandSelectNeedles, valuesMatch } from "./transforms.js";

describe("expandSelectNeedles", () => {
  it("maps FNB to Firstrand search terms", () => {
    assert.deepEqual(expandSelectNeedles("FNB"), ["FNB", "FIRSTRAND", "FIRST NATIONAL"]);
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
