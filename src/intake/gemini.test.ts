import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractJsonObject,
  coerceLlmFields,
  enrichWithGemini,
  needsEmployerSearch,
  employerSearchColumns,
} from "./gemini.js";
import { loadIntakeMapping } from "./mapping.js";

describe("gemini json parse", () => {
  it("reads a fenced JSON object", () => {
    const parsed = extractJsonObject('```json\n{"Full name":"Ada Lovelace"}\n```');
    assert.equal(parsed["Full name"], "Ada Lovelace");
  });

  it("maps columns case-insensitively and fills blanks", () => {
    const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
    const fields = coerceLlmFields({ "full name": "Ada Lovelace", Email: "ada@example.com" }, mapping);
    assert.equal(fields["Full name"], "Ada Lovelace");
    assert.equal(fields.Email, "ada@example.com");
    assert.equal(fields["ID number"], "");
    assert.equal(Object.prototype.hasOwnProperty.call(fields, "NR"), false);
  });
});

describe("employer web search", () => {
  const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
  const searchCols = employerSearchColumns(mapping);

  it("knows the four online-search employer columns", () => {
    assert.equal(searchCols.length, 4);
    assert.ok(searchCols.every((column) => column.includes("online search")));
  });

  it("does not search when those columns are already filled", () => {
    const fields: Record<string, string> = {};
    for (const column of searchCols) fields[column] = "filled";
    assert.equal(needsEmployerSearch(fields, mapping), false);
  });

  it("searches when an employer column is Unknown", () => {
    const fields: Record<string, string> = {};
    for (const column of searchCols) fields[column] = "Unknown";
    assert.equal(needsEmployerSearch(fields, mapping), true);
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

  it("skips google_search when the first response already has employer fields", async () => {
    const payload: Record<string, string> = { "Full name": "Ada Lovelace", Email: "ada@example.com" };
    for (const column of searchCols) payload[column] = "0123456789";
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse(payload);
    }) as typeof fetch;

    await enrichWithGemini(mapping, "form row", {
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      fetchImpl,
    });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].tools, undefined);
  });

  it("retries with google_search when employer fields are Unknown", async () => {
    const unknownPayload: Record<string, string> = { "Full name": "Ada Lovelace" };
    for (const column of searchCols) unknownPayload[column] = "Unknown";
    const filledPayload: Record<string, string> = { "Full name": "Ada Lovelace" };
    for (const column of searchCols) filledPayload[column] = "1 Employer Rd";

    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return jsonResponse(body.tools ? filledPayload : unknownPayload);
    }) as typeof fetch;

    const fields = await enrichWithGemini(mapping, "form row", {
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      fetchImpl,
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].tools, undefined);
    assert.deepEqual(bodies[1].tools, [{ google_search: {} }]);
    assert.equal(fields[searchCols[0]], "1 Employer Rd");
  });
});
