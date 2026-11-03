import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvedLeadsToCarry,
  approvedRowMissing,
  normalizeLoadedPhone,
  planLoadedUpsert,
  sameLoadedPerson,
} from "./loadedClientIdentity.js";

describe("normalizeLoadedPhone", () => {
  it("treats trunk 0, stripped 0, and 27-prefix as the same mobile", () => {
    assert.equal(normalizeLoadedPhone("0715316597"), "0715316597");
    assert.equal(normalizeLoadedPhone("715316597"), "0715316597");
    assert.equal(normalizeLoadedPhone("27715316597"), "0715316597");
    assert.equal(normalizeLoadedPhone(715316597), "0715316597");
  });
});

describe("planLoadedUpsert", () => {
  const buhle = { rowIndex: 543, name: "Buhle Masinga", number: "0715316597" };

  it("does not append Buhle again when her number was stored without the leading 0", () => {
    const plan = planLoadedUpsert(
      [{ ...buhle, number: "715316597" }],
      "Buhle Masinga",
      "0715316597"
    );
    assert.deepEqual(plan, { action: "present", rowIndex: 543 });
  });

  it("appends a different person who shares a cellphone instead of skipping them", () => {
    const plan = planLoadedUpsert(
      [{ rowIndex: 210, name: "Thembani Mbangatha", number: "0719184625" }],
      "Michael Tevin Trevor Jnr Kuypers",
      "719184625"
    );
    assert.equal(plan.action, "append");
    if (plan.action === "append") {
      assert.equal(plan.sharedPhoneName, "Thembani Mbangatha");
    }
  });

  it("updates the number when the same person is already on the sheet", () => {
    const plan = planLoadedUpsert([buhle], "Buhle  Masinga", "0820000000");
    assert.equal(plan.action, "update");
    if (plan.action === "update") {
      assert.equal(plan.rowIndex, 543);
      assert.equal(plan.number, "0820000000");
    }
  });

  it("treats a doubled token as the same person", () => {
    assert.equal(sameLoadedPerson("Nazile", "Nazile Nazile"), true);
    const plan = planLoadedUpsert(
      [{ rowIndex: 510, name: "Nazile Nazile", number: "0839790041" }],
      "Nazile",
      "0839790041"
    );
    assert.deepEqual(plan, { action: "present", rowIndex: 510 });
  });
});

describe("approvedLeadsToCarry", () => {
  const approvedTab = [{ name: "Buhle Masinga", number: "715316597" }];
  const leads = [
    { rowIndex: 43, name: "Vinay Maharaj", number: "0817022504", status: "Approved" },
    { rowIndex: 543, name: "Buhle Masinga", number: "0715316597", status: "Approved" },
    { rowIndex: 600, name: "Anele Dlamini", number: "0821112222", status: "Approved" },
    { rowIndex: 601, name: "Ryan Madern", number: "0730328094", status: "" },
  ];

  it("copies a recent approved client who is missing from the Approved tab", () => {
    const carry = approvedLeadsToCarry(leads, approvedTab, 120);
    assert.deepEqual(
      carry.map((row) => row.name),
      ["Anele Dlamini"]
    );
  });

  it("leaves Buhle off the copy list once she is already on the Approved tab", () => {
    assert.equal(approvedRowMissing(approvedTab, "Buhle Masinga", "0715316597"), false);
  });

  it("does not treat a blank-name row with the same phone as already carrying that client", () => {
    const tab = [{ name: "", number: "0715316597" }];
    assert.equal(approvedRowMissing(tab, "Buhle Masinga", "0715316597"), true);
  });

  it("does not backfill approvals outside the recent window", () => {
    const carry = approvedLeadsToCarry(leads, approvedTab, 120);
    assert.equal(
      carry.some((row) => row.name === "Vinay Maharaj"),
      false
    );
  });

  it("carries Approved no message sent and can scan the full Leads sheet", () => {
    const allLeads = [
      ...leads,
      {
        rowIndex: 628,
        name: "Damien Pasich-Britz",
        number: "0820001234",
        status: "Approved no message sent",
      },
    ];
    const carry = approvedLeadsToCarry(allLeads, approvedTab, null);
    assert.equal(
      carry.some((row) => row.name === "Damien Pasich-Britz"),
      true
    );
  });

  it("carries Approved leads even when Number is blank (name only)", () => {
    const allLeads = [
      ...leads,
      { rowIndex: 664, name: "willie", number: "", status: "Approved" },
      { rowIndex: 665, name: "Willem", number: "", status: "Approved" },
    ];
    const carry = approvedLeadsToCarry(allLeads, approvedTab, null);
    assert.deepEqual(
      carry.filter((row) => row.rowIndex >= 664).map((row) => row.name),
      ["willie", "Willem"]
    );
  });
});
