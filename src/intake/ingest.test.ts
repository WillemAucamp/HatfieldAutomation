import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capIntakeRows } from "./ingest.js";

describe("capIntakeRows", () => {
  it("leaves the list unchanged when max is 0 (unlimited)", () => {
    const rows = [1, 2, 3, 4, 5];
    assert.deepEqual(capIntakeRows(rows, 0), { rows, remaining: 0 });
  });

  it("leaves the list unchanged when it is already within the cap", () => {
    const rows = [1, 2];
    assert.deepEqual(capIntakeRows(rows, 5), { rows, remaining: 0 });
  });

  it("keeps leftover rows unprocessed so a later click can pick them up", () => {
    assert.deepEqual(capIntakeRows([1, 2, 3, 4, 5, 6], 2), {
      rows: [1, 2],
      remaining: 4,
    });
  });
});
