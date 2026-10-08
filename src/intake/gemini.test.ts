import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractJsonObject,
  coerceLlmFields,
  enrichWithGemini,
  enrichEmployerWithSearch,
  employerSearchColumns,
  needsEmployerPhone,
  normalizeEmployerPhone,
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
    assert.equal(fields["Employee level"], "");
    assert.equal(Object.prototype.hasOwnProperty.call(fields, "Telephone payment"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(fields, "Full name"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(fields, "NR"), false);
  });
});

describe("normalizeEmployerPhone", () => {
  it("normalises +27 and spaced landlines to 0XXXXXXXXX", () => {
    assert.equal(normalizeEmployerPhone("+27 11 123 4567"), "0111234567");
    assert.equal(normalizeEmployerPhone("011 123 4567"), "0111234567");
    assert.equal(normalizeEmployerPhone("Unknown"), "");
    assert.equal(normalizeEmployerPhone(""), "");
  });

  it("pulls a phone out of messy search text", () => {
    assert.equal(
      normalizeEmployerPhone("Call us on +27 (11) 555-0199 or email hello@x.co.za"),
      "0115550199"
    );
  });
});

describe("employer columns", () => {
  const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
  const searchCols = employerSearchColumns(mapping);
  const phoneCol = "Employer telephone number (online search)";

  it("knows the four online-search employer columns", () => {
    assert.equal(searchCols.length, 4);
    assert.ok(searchCols.every((column) => column.includes("online search")));
  });

  it("flags missing or unknown employer phone", () => {
    assert.equal(needsEmployerPhone({ [phoneCol]: "" }), true);
    assert.equal(needsEmployerPhone({ [phoneCol]: "Unknown" }), true);
    assert.equal(needsEmployerPhone({ [phoneCol]: "0111234567" }), false);
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

  it("skips google_search when employer phone is already valid", async () => {
    const payload: Record<string, string> = {
      "Postal code": "2196",
      [phoneCol]: "0111234567",
    };
    for (const column of searchCols) {
      if (!payload[column]) payload[column] = "1 Work Ave";
    }
    payload[phoneCol] = "0111234567";
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
    assert.equal(fields[phoneCol], "0111234567");
  });

  it("brute-forces google_search until a usable employer phone is found", async () => {
    const firstPass: Record<string, string> = { "Postal code": "2196" };
    for (const column of searchCols) firstPass[column] = "";

    const bodies: Array<Record<string, unknown>> = [];
    let call = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      call += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (call === 1) return jsonResponse(firstPass);
      if (call === 2) {
        return jsonResponse({ [phoneCol]: "Unknown" });
      }
      return jsonResponse({ [phoneCol]: "+27 21 555 0100" });
    }) as typeof fetch;

    const fields = await enrichWithGemini(mapping, "Name of Company you work for? Pick n Pay", {
      apiKey: "test-key",
      model: "gemini-3.6-flash",
      fetchImpl,
      employerSearchAttempts: 3,
    });

    assert.equal(bodies.length, 3);
    assert.equal(bodies[0].tools, undefined);
    assert.ok(Array.isArray(bodies[1].tools));
    assert.deepEqual(bodies[1].tools, [{ google_search: {} }]);
    assert.deepEqual(bodies[2].tools, [{ google_search: {} }]);
    assert.equal(fields[phoneCol], "0215550100");
  });

  it("enrichEmployerWithSearch alone retries and merges", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return jsonResponse({ [phoneCol]: "" });
      return jsonResponse({
        [phoneCol]: "011 234 5678",
        "Employer street address (online search)": "1 Main Rd",
      });
    }) as typeof fetch;

    const fields = await enrichEmployerWithSearch(
      mapping,
      "employer Acme",
      { apiKey: "k", model: "m", fetchImpl, employerSearchAttempts: 3 },
      { [phoneCol]: "" }
    );
    assert.equal(call, 2);
    assert.equal(fields[phoneCol], "0112345678");
    assert.equal(fields["Employer street address (online search)"], "1 Main Rd");
  });
});
