import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { joinColumns, llmColumns, loadIntakeMapping, writerColumns } from "./mapping.js";

describe("intake mapping", () => {
  it("keeps Gemini off NR/Status/Timing and off copy columns", () => {
    const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
    assert.deepEqual(writerColumns(mapping), ["NR", "Status", "Timing"]);
    const llm = llmColumns(mapping);
    assert.equal(llm.includes("NR"), false);
    assert.equal(llm.includes("Full name"), false);
    assert.equal(llm.includes("First names + surname"), false);
    assert.equal(llm.includes("Title"), false);
    assert.equal(llm.includes("Address line"), false);
    assert.equal(llm.includes("Next of kin name + Surname"), false);
    assert.ok(llm.includes("Industry (AI based on employer)"));
    assert.ok(llm.includes("Postal code"));
    assert.equal(mapping.destination_columns[0], "NR");
    assert.equal(mapping.destination_columns.at(-1), "Timing");
    assert.equal(mapping.destination_columns.length, 38);
    const joins = joinColumns(mapping).map((e) => e.destination);
    assert.deepEqual(joins, ["Next of kin name + Surname"]);
    assert.equal(
      mapping.intake_headers.street_address,
      "Current STREET address and House number Example: 1058 Steve Biko Road"
    );
  });
});
