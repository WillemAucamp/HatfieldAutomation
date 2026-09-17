import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SHEET_CSV_URL,
  DEFAULT_SHEET_ID,
  exportCsvUrl,
  extractGid,
  extractSheetId,
  gvizCsvUrl,
} from "./sheetCsv.js";

describe("sheetCsv urls", () => {
  it("does not ship a hard-coded personal sheet as the product default", () => {
    assert.equal(DEFAULT_SHEET_ID, "");
    assert.equal(DEFAULT_SHEET_CSV_URL, "");
  });

  it("builds gviz and export URLs for a sheet id", () => {
    const id = "EXAMPLE_CLIENT_SHEET_ID";
    assert.equal(
      gvizCsvUrl(id),
      `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=0`
    );
    assert.equal(
      exportCsvUrl(id, "0"),
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`
    );
  });

  it("extracts sheet id and gid from either URL shape", () => {
    const id = "EXAMPLE_CLIENT_SHEET_ID";
    assert.equal(extractSheetId(gvizCsvUrl(id, "12")), id);
    assert.equal(extractGid(exportCsvUrl(id, "12")), "12");
    assert.equal(extractGid(gvizCsvUrl(id)), "0");
  });
});
