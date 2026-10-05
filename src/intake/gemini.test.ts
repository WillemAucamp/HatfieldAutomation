import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJsonObject, coerceLlmFields } from "./gemini.js";
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
