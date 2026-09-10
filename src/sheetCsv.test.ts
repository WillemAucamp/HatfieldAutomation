import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SHEET_CSV_URL,
  csvCandidateUrls,
  exportCsvUrl,
  extractGid,
  extractSheetId,
  gvizCsvUrl,
} from "./sheetCsv.js";

describe("sheetCsv urls", () => {
  it("defaults to the export CSV endpoint", () => {
    assert.match(DEFAULT_SHEET_CSV_URL, /export\?format=csv/);
  });

  it("tries /export before gviz so text-formatted ID cells are not dropped", () => {
    const id = "12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI";
    const preferred = gvizCsvUrl(id);
    const order = csvCandidateUrls(preferred);
    assert.equal(order[0], exportCsvUrl(id));
    assert.ok(order.includes(preferred));
  });

  it("builds gviz and export URLs for a sheet id", () => {
    const id = "12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI";
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
    const id = "12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI";
    assert.equal(extractSheetId(gvizCsvUrl(id, "12")), id);
    assert.equal(extractGid(exportCsvUrl(id, "12")), "12");
    assert.equal(extractGid(gvizCsvUrl(id)), "0");
  });
});
