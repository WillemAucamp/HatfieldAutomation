import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNotifiableLeadStatus,
  normalizeSaWhatsappPhone,
  templateKeyForStatus,
} from "./phone.js";

describe("normalizeSaWhatsappPhone", () => {
  it("normalizes local, +27, and 27 forms", () => {
    assert.equal(normalizeSaWhatsappPhone("0821234567"), "27821234567");
    assert.equal(normalizeSaWhatsappPhone("+27 82 123 4567"), "27821234567");
    assert.equal(normalizeSaWhatsappPhone("27821234567"), "27821234567");
    assert.equal(normalizeSaWhatsappPhone("82-123-4567"), "27821234567");
  });

  it("rejects incomplete numbers", () => {
    assert.equal(normalizeSaWhatsappPhone(""), "");
    assert.equal(normalizeSaWhatsappPhone("082"), "");
    assert.equal(normalizeSaWhatsappPhone("12345"), "");
  });
});

describe("lead status helpers", () => {
  it("recognizes Approved and Declined only", () => {
    assert.equal(isNotifiableLeadStatus("Approved"), true);
    assert.equal(isNotifiableLeadStatus("declined"), true);
    assert.equal(isNotifiableLeadStatus("Pending"), false);
    assert.equal(templateKeyForStatus("Approved"), "approve");
    assert.equal(templateKeyForStatus("Declined"), "decline");
    assert.equal(templateKeyForStatus("Pending"), null);
  });
});
