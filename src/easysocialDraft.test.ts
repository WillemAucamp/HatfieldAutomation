import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEasysocialRecipients } from "./config.js";
import {
  buildEasysocialSubject,
  isEasysocialDraftMarked,
  resolveVehicleFromIntake,
} from "./easysocialDraft.js";
import { loadIntakeMapping } from "./intake/mapping.js";
import type { ApplicantRecord } from "./types.js";

describe("parseEasysocialRecipients", () => {
  it("splits comma-separated emails", () => {
    assert.deepEqual(parseEasysocialRecipients("a@x.com, b@y.com ,c@z.com"), [
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });
});

describe("buildEasysocialSubject", () => {
  it("formats strict Easysocial subject line", () => {
    assert.equal(
      buildEasysocialSubject("Thabo Mokoena", "FNB", "ZAHTVW123456"),
      "Easysocial: Thabo Mokoena - FNB - ZAHTVW123456"
    );
  });

  it("normalizes reference from success popup text", () => {
    assert.equal(
      buildEasysocialSubject("Ada Lovelace", "Capitec", "Your reference number is: zahtvw999"),
      "Easysocial: Ada Lovelace - Capitec - ZAHTVW999"
    );
  });
});

describe("isEasysocialDraftMarked", () => {
  it("detects common marker values", () => {
    assert.equal(isEasysocialDraftMarked(""), false);
    assert.equal(isEasysocialDraftMarked("yes"), true);
    assert.equal(isEasysocialDraftMarked("draft:abc123"), true);
    assert.equal(isEasysocialDraftMarked("no"), false);
  });
});

describe("resolveVehicleFromIntake", () => {
  const mapping = loadIntakeMapping("./config/intake-mapping.yaml");
  const applicant: ApplicantRecord = {
    rowIndex: 42,
    rowId: "id",
    email: "thabo@example.com",
    firstName: "Thabo",
    surname: "Sample",
    initials: "T",
    title: "Mr",
    educationalLevel: "",
    idNumber: "8001015800084",
    mobile: "0820000001",
    addressLine1: "",
    postalCode: "",
    province: "",
    residencyStartDate: "",
    nextOfKinName: "",
    nextOfKinSurname: "",
    industry: "",
    occupation: "",
    employeeLevel: "",
    maritalStatus: "",
    maxPrice: "",
    employerName: "",
    employerPhone: "",
    employerAddress: "",
    employerPostalCode: "",
    employerProvince: "",
    employmentStartDate: "",
    grossMonthly: "",
    nettSalary: "",
    telephoneExpense: "",
    transportExpense: "",
    foodExpense: "",
    accountHolder: "",
    bank: "FNB",
    accountType: "",
    nextOfKinRelationship: "",
    errors: [],
  };

  it("returns vehicle_interest from matched intake row", () => {
    const intakeRows = [
      {
        rowIndex: 5,
        values: {
          "Email address": "thabo@example.com",
          "ID Number": "8001015800084",
          "Enrichment Status": "enriched row 42 nr 41",
          [mapping.intake_headers.vehicle_interest]: "VW Polo Vivo 1.4",
        },
      },
    ];
    const { body, matched } = resolveVehicleFromIntake(
      applicant,
      intakeRows,
      mapping,
      42
    );
    assert.equal(matched, true);
    assert.equal(body, "VW Polo Vivo 1.4");
  });

  it("uses placeholder when no match", () => {
    const { body, matched } = resolveVehicleFromIntake(applicant, [], mapping, 42);
    assert.equal(matched, false);
    assert.match(body, /could not be matched/i);
  });
});
