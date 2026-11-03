import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isApprovedForCarryTab } from "./leadStatus.js";

describe("isApprovedForCarryTab", () => {
  it("includes plain Approved and Approved no message sent", () => {
    assert.equal(isApprovedForCarryTab("Approved"), true);
    assert.equal(isApprovedForCarryTab("approved"), true);
    assert.equal(isApprovedForCarryTab("Approved no message sent"), true);
    assert.equal(isApprovedForCarryTab("  Approved   no   message sent  "), true);
  });

  it("excludes Declined and unrelated statuses", () => {
    assert.equal(isApprovedForCarryTab("Declined"), false);
    assert.equal(isApprovedForCarryTab("Pending"), false);
    assert.equal(isApprovedForCarryTab("Approved pending"), false);
  });
});
