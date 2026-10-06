import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExpenseSummary } from "./expenses.js";

describe("parseExpenseSummary", () => {
  it("maps food, accounts, and household lines into Seriti expense buckets", () => {
    const parsed = parseExpenseSummary("Food 3000 accounts 2000 wifi 500 electricity 800");
    assert.equal(parsed.food, "3000");
    assert.equal(parsed.telephone, "2000");
    assert.equal(parsed.transport, "1300");
  });

  it("prefers explicit transport over household fold-in", () => {
    const parsed = parseExpenseSummary("Food R1000 Transport R400 electricity R200");
    assert.equal(parsed.food, "1000");
    assert.equal(parsed.transport, "400");
  });
});
