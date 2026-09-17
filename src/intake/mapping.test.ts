import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { llmColumns, loadIntakeMapping, writerColumns } from "./mapping.js";

describe("intake mapping", () => {
  it("keeps Gemini off NR/Status/Timing", () => {
    const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
    assert.deepEqual(writerColumns(mapping), ["NR", "Status", "Timing"]);
    assert.equal(llmColumns(mapping).includes("NR"), false);
    assert.equal(mapping.destination_columns[0], "NR");
    assert.equal(mapping.destination_columns.at(-1), "Timing");
    assert.equal(mapping.destination_columns.length, 35);
  });
});
