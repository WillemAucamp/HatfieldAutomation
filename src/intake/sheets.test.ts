import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUsableSheetRow, matchAppendedSheetRow } from "./sheets.js";

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
