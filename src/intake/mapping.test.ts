import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  joinColumns,
  llmColumns,
  loadIntakeMapping,
  requiredIntakeHeaderLabels,
  writerColumns,
} from "./mapping.js";

describe("intake mapping", () => {
  it("keeps Gemini off NR/Status/Timing and off copy/join columns", () => {
    const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
    const writers = writerColumns(mapping);
    assert.ok(writers.includes("NR"));
    assert.ok(writers.includes("Status"));
    assert.ok(writers.includes("Timing"));
    assert.ok(writers.includes("Next of kin relationship"));
    assert.ok(writers.includes("Max price range"));
    const llm = llmColumns(mapping);
    assert.equal(llm.includes("NR"), false);
    assert.equal(llm.includes("Full name"), false);
    assert.equal(llm.includes("First names + surname"), false);
    assert.equal(llm.includes("Title"), false);
    assert.equal(llm.includes("Occupation"), false);
    assert.ok(llm.includes("Industry (AI based on employer)"));
    assert.ok(llm.includes("Postal code"));
    assert.ok(joinColumns(mapping).some((e) => e.destination === "Address line"));
    assert.ok(
      joinColumns(mapping).some((e) => e.destination === "Next of kin name + Surname")
    );
    assert.ok(requiredIntakeHeaderLabels(mapping).some((h) => /STREET address/i.test(h)));
    assert.equal(mapping.destination_columns[0], "NR");
    assert.equal(mapping.destination_columns.at(-1), "Timing");
    assert.equal(mapping.destination_columns.length, 38);
  });
});
