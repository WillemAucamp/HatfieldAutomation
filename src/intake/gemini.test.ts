import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractJsonObject,
  coerceLlmFields,
  enrichWithGemini,
  employerSearchColumns,
} from "./gemini.js";
import { loadIntakeMapping } from "./mapping.js";

describe("gemini json parse", () => {
  it("reads a fenced JSON object", () => {
    const parsed = extractJsonObject('```json\n{"Postal code":"2196"}\n```');
    assert.equal(parsed["Postal code"], "2196");
  });

  it("maps infer columns case-insensitively and fills blanks", () => {
    const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
    const fields = coerceLlmFields(
      { "postal code": "2196", "Industry (AI based on employer)": "Retail" },
      mapping
    );
    assert.equal(fields["Postal code"], "2196");
    assert.equal(fields["Industry (AI based on employer)"], "Retail");
    assert.equal(fields["Telephone payment"], "");
    assert.equal(Object.prototype.hasOwnProperty.call(fields, "Full name"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(fields, "NR"), false);
  });
});

describe("employer columns", () => {
  const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
  const searchCols = employerSearchColumns(mapping);

  it("knows the four online-search employer columns", () => {
    assert.equal(searchCols.length, 4);
    assert.ok(searchCols.every((column) => column.includes("online search")));
  });

  function jsonResponse(payload: Record<string, string>) {
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      }),
      status: 200,
    };
  }

  it("makes a single Gemini call without google_search", async () => {
    const payload: Record<string, string> = { "Postal code": "2196" };
    for (const column of searchCols) payload[column] = "Unknown";
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse(payload);
    }) as typeof fetch;

    const fields = await enrichWithGemini(mapping, "form row", {
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      fetchImpl,
    });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].tools, undefined);
    assert.equal(fields[searchCols[0]], "Unknown");
  });
});
