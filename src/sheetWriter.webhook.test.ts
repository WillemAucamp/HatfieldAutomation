import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppsScriptProbeResponse } from "./sheetWriter.js";

describe("isAppsScriptProbeResponse", () => {
  it("detects the doGet version probe that 302 confirmations sometimes return", () => {
    assert.equal(
      isAppsScriptProbeResponse({
        ok: true,
        version: "hatfield-leads-1",
        actions: ["readSheet", "appendApplicant"],
        leadsSheetGid: 1730847217,
      }),
      true
    );
  });

  it("does not treat a real readSheet payload as a probe", () => {
    assert.equal(
      isAppsScriptProbeResponse({
        ok: true,
        spreadsheetId: "abc",
        sheetName: "Form Responses 1",
        headers: ["Timestamp"],
        rows: [],
      }),
      false
    );
  });

  it("does not treat a real appendApplicant payload as a probe", () => {
    assert.equal(
      isAppsScriptProbeResponse({
        ok: true,
        row: 340,
        nr: 341,
        spreadsheetId: "abc",
        sheetName: "Sheet1",
      }),
      false
    );
  });
});
