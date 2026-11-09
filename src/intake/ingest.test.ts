import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capIntakeRows, NO_CONSENT_GIVEN_STATUS, stampIngestRowStatus } from "./ingest.js";

describe("capIntakeRows", () => {
  it("leaves the list unchanged when max is 0 (unlimited)", () => {
    const rows = [1, 2, 3, 4, 5];
    assert.deepEqual(capIntakeRows(rows, 0), { rows, remaining: 0 });
  });

  it("leaves the list unchanged when it is already within the cap", () => {
    const rows = [1, 2];
    assert.deepEqual(capIntakeRows(rows, 5), { rows, remaining: 0 });
  });

  it("keeps leftover rows unprocessed so a later click can pick them up", () => {
    assert.deepEqual(capIntakeRows([1, 2, 3, 4, 5, 6], 2), {
      rows: [1, 2],
      remaining: 4,
    });
  });
});

describe("stampIngestRowStatus", () => {
  it("appends a declined-consent row with a status Seriti will not load", () => {
    const stamped = stampIngestRowStatus(
      { "Full name": "Promise Moiane", "ID number": "8603206249081", Status: "" },
      { consent: "No" }
    );
    assert.equal(stamped.consentBlocked, true);
    assert.equal(stamped.values.Status, NO_CONSENT_GIVEN_STATUS);
    assert.equal(stamped.values["Full name"], "Promise Moiane");
  });

  it("leaves Status blank when consent is Yes and the ID is usable", () => {
    const stamped = stampIngestRowStatus(
      { "ID number": "8603206249081", Status: "" },
      { consent: "Yes" }
    );
    assert.equal(stamped.consentBlocked, false);
    assert.equal(stamped.values.Status, "");
  });

  it("still stamps a bad ID when consent was given", () => {
    const stamped = stampIngestRowStatus(
      { "ID number": "9910125324080", Status: "" },
      { consent: "Yes" }
    );
    assert.equal(stamped.consentBlocked, false);
    assert.match(stamped.values.Status, /^error ID_/);
  });
});
