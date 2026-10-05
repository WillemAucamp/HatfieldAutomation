import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { columnIndexToLetter, isWhatsAppAlreadySent, leadNeedsWhatsApp } from "./leads.js";

describe("leadNeedsWhatsApp", () => {
  it("requires Approved/Declined, unsent, and valid phone", () => {
    assert.equal(
      leadNeedsWhatsApp({ status: "Approved", whatsappSent: "", number: "0821234567" }),
      true
    );
    assert.equal(
      leadNeedsWhatsApp({ status: "Declined", whatsappSent: "No", number: "0821234567" }),
      true
    );
    assert.equal(
      leadNeedsWhatsApp({ status: "Approved", whatsappSent: "Yes", number: "0821234567" }),
      false
    );
    assert.equal(
      leadNeedsWhatsApp({ status: "Pending", whatsappSent: "", number: "0821234567" }),
      false
    );
    assert.equal(
      leadNeedsWhatsApp({ status: "Approved", whatsappSent: "", number: "bad" }),
      false
    );
  });
});

describe("isWhatsAppAlreadySent", () => {
  it("treats Yes / sent* as already sent", () => {
    assert.equal(isWhatsAppAlreadySent("Yes"), true);
    assert.equal(isWhatsAppAlreadySent("sent 2026-09-10"), true);
    assert.equal(isWhatsAppAlreadySent("No"), false);
    assert.equal(isWhatsAppAlreadySent(""), false);
  });
});

describe("columnIndexToLetter", () => {
  it("maps 1-based indexes to A1 letters", () => {
    assert.equal(columnIndexToLetter(1), "A");
    assert.equal(columnIndexToLetter(26), "Z");
    assert.equal(columnIndexToLetter(27), "AA");
  });
});
