import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTerminalIntakeStatus,
  isUsableSheetRow,
  matchAppendedSheetRow,
} from "./sheets.js";

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
