import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_INTAKE_SHEET_GID,
  explicitSheetSelector,
  intakeSheetSelector,
  isFailedEnrichmentRowZero,
  isTerminalIntakeStatus,
  isUsableSheetRow,
  matchAppendedSheetRow,
} from "./sheets.js";

describe("intakeSheetSelector", () => {
  it("prefers tab gid so other person tabs are never read", () => {
    assert.deepEqual(
      intakeSheetSelector({
        intakeSheetGid: DEFAULT_INTAKE_SHEET_GID,
        intakeSheetName: "Willem/ Sihle",
      }),
      { sheetGid: DEFAULT_INTAKE_SHEET_GID }
    );
  });

  it("falls back to the Willem/Sihle tab name when gid is missing", () => {
    assert.deepEqual(intakeSheetSelector({ intakeSheetName: "Willem/ Sihle" }), {
      sheetName: "Willem/ Sihle",
    });
    assert.deepEqual(intakeSheetSelector({}), { sheetName: "Willem/ Sihle" });
  });
});

describe("explicitSheetSelector", () => {
  it("leaves automation-sheet reads on the default tab", () => {
    assert.deepEqual(explicitSheetSelector({}), {});
  });

  it("passes through a caller-supplied gid or name", () => {
    assert.deepEqual(explicitSheetSelector({ sheetGid: 880063023, sheetName: "x" }), {
      sheetGid: 880063023,
    });
    assert.deepEqual(explicitSheetSelector({ sheetName: "Sheet1" }), { sheetName: "Sheet1" });
  });
});

describe("isTerminalIntakeStatus", () => {
  it("treats Melrose pipeline values as terminal", () => {
    assert.equal(isTerminalIntakeStatus("enriched row 328 nr 329"), true);
    assert.equal(isTerminalIntakeStatus("skipped_already_loaded"), true);
    assert.equal(isTerminalIntakeStatus("processing"), true);
    assert.equal(isTerminalIntakeStatus("error GEMINI_TIMEOUT"), true);
  });

  it("does not treat Form answers or empty/new/retry as terminal", () => {
    assert.equal(isTerminalIntakeStatus(""), false);
    assert.equal(isTerminalIntakeStatus("new"), false);
    assert.equal(isTerminalIntakeStatus("retry"), false);
    assert.equal(
      isTerminalIntakeStatus("Im not sure, but it should be GOOD"),
      false
    );
  });

  it("does not treat enriched row 0 (lost Apps Script confirmation) as terminal", () => {
    assert.equal(isTerminalIntakeStatus("enriched row 0 nr 0"), false);
    assert.equal(isFailedEnrichmentRowZero("enriched row 0 nr 0"), true);
    assert.equal(isFailedEnrichmentRowZero("enriched row 340 nr 341"), false);
  });
});

describe("isUsableSheetRow", () => {
  it("rejects the fake row 0 Apps Script 302 responses return", () => {
    assert.equal(isUsableSheetRow(0), false);
    assert.equal(isUsableSheetRow(1), false);
    assert.equal(isUsableSheetRow(2), true);
    assert.equal(isUsableSheetRow(96), true);
  });
});

describe("matchAppendedSheetRow", () => {
  const rows = [
    {
      rowIndex: 95,
      values: {
        Email: "old@example.com",
        "Full name": "Old Person",
        NR: "93",
      },
    },
    {
      rowIndex: 96,
      values: {
        Email: "khehle@example.com",
        "Full name": "Khehle sandile Mdakane",
        NR: "94",
      },
    },
  ];

  it("finds the last blank-status row by email", () => {
    assert.deepEqual(
      matchAppendedSheetRow(rows, { Email: "khehle@example.com", "Full name": "Anyone" }),
      { row: 96, nr: 94 }
    );
  });

  it("finds by applicant name when email is missing from the webhook body", () => {
    assert.deepEqual(
      matchAppendedSheetRow(rows, {
        Email: "",
        "First names + surname": "Khehle sandile Mdakane",
      }),
      { row: 96, nr: 94 }
    );
  });

  it("returns null when nothing matches", () => {
    assert.equal(matchAppendedSheetRow(rows, { Email: "missing@example.com" }), null);
  });
});
