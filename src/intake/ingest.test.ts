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
  const validId = "8603206249081";

  it("appends declined-consent rows with error_no_consent_given instead of dropping them", () => {
    const stamped = stampIngestRowStatus(
      { "Full name": "Fatima Hassim", "ID number": validId, Status: "" },
      { consent: "No" }
    );
    assert.equal(stamped.consentBlocked, true);
    assert.equal(stamped.values.Status, NO_CONSENT_GIVEN_STATUS);
    assert.equal(stamped.values.Status, "error_no_consent_given");
    assert.equal(stamped.values["Full name"], "Fatima Hassim");
  });

  it("does not block blank consent or Yes", () => {
    assert.equal(
      stampIngestRowStatus({ "ID number": validId }, { consent: "" }).consentBlocked,
      false
    );
    assert.equal(
      stampIngestRowStatus({ "ID number": validId }, { consent: "Yes" }).values.Status,
      undefined
    );
  });

  it("keeps a bad RSA ID blocked even when consent is Yes", () => {
    const stamped = stampIngestRowStatus(
      { "ID number": "123", Status: "" },
      { consent: "Yes" }
    );
    assert.equal(stamped.consentBlocked, false);
    assert.match(stamped.values.Status, /ID_NOT_13_DIGITS/);
  });
});
