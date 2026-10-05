import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planMelroseLoad, usableAutomationRows } from "./watchIntake.js";

describe("usableAutomationRows", () => {
  it("drops Apps Script row 0 and the header row", () => {
    assert.deepEqual(usableAutomationRows([0, 1, 101, 102]), [101, 102]);
  });
});

describe("planMelroseLoad", () => {
  it("always loads Seriti after a full ingest, even when nobody was appended", () => {
    const plan = planMelroseLoad({
      skipLoad: false,
      autoLoad: true,
      dryRun: false,
      skipIngest: false,
      appendedSheetRows: [],
    });
    assert.equal(plan.shouldLoad, true);
    assert.equal(plan.clearRowFilter, true);
    assert.match(plan.log, /leftover blank-Status/);
  });

  it("loads every blank-Status row after ingest, not only the new row numbers", () => {
    const plan = planMelroseLoad({
      skipLoad: false,
      autoLoad: true,
      dryRun: false,
      skipIngest: false,
      appendedSheetRows: [111, 112],
    });
    assert.equal(plan.shouldLoad, true);
    assert.equal(plan.clearRowFilter, true);
    assert.match(plan.log, /111, 112/);
  });

  it("still loads when appendApplicant returned row 0", () => {
    const plan = planMelroseLoad({
      skipLoad: false,
      autoLoad: true,
      dryRun: false,
      skipIngest: false,
      appendedSheetRows: [0],
    });
    assert.equal(plan.shouldLoad, true);
    assert.equal(plan.clearRowFilter, true);
    assert.match(plan.log, /not usable/);
  });

  it("does not load during ingest-only", () => {
    const plan = planMelroseLoad({
      skipLoad: true,
      autoLoad: false,
      dryRun: false,
      skipIngest: false,
      appendedSheetRows: [101],
    });
    assert.equal(plan.shouldLoad, false);
    assert.match(plan.log, /Skipping Melrose load/);
  });

  it("keeps ROW_FILTER for load-only", () => {
    const plan = planMelroseLoad({
      skipLoad: false,
      autoLoad: true,
      dryRun: false,
      skipIngest: true,
      appendedSheetRows: [],
    });
    assert.equal(plan.shouldLoad, true);
    assert.equal(plan.clearRowFilter, false);
  });
});
