import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandSelectNeedles, formatDateForForm, initialsFromFirstNames, parseDurationToMmDdYyyy, parsePersonName, postalSearchNeedles, restoreIdNumber, restorePostalCode, splitNextOfKinName, titleFromGender, validateDateFormat, validateIdNumber, valuesMatch } from "./transforms.js";

describe("expandSelectNeedles", () => {
  it("maps FNB to Firstrand search terms", () => {
    assert.deepEqual(expandSelectNeedles("FNB"), ["FNB", "FIRSTRAND", "FIRST NATIONAL"]);
  });

  it("maps Standardbank (one word) to Standard Bank search terms", () => {
    const terms = expandSelectNeedles("Standardbank").map((t) => t.toLowerCase());
    assert.ok(terms.includes("standard bank"));
    assert.ok(terms.includes("standard"));
  });

  it("maps Cheque/Current to current then cheque", () => {
    const terms = expandSelectNeedles("Cheque/Current").map((t) => t.toLowerCase());
    assert.ok(terms.includes("current"));
    assert.ok(terms.includes("cheque"));
  });

  it("maps Savings/Transactional to savings", () => {
    const terms = expandSelectNeedles("Savings/Transactional").map((t) => t.toLowerCase());
    assert.ok(terms.includes("savings"));
  });

  it("maps Matric certificate to Grade 12 search terms", () => {
    const terms = expandSelectNeedles("Matric certificate").map((t) => t.toLowerCase());
    assert.ok(terms.includes("grade 12"));
  });
});

describe("valuesMatch bank aliases", () => {
  it("treats FNB as matching FIRSTRAND BANK LIMITED", () => {
    assert.equal(valuesMatch("FNB", "FIRSTRAND BANK LIMITED"), true);
  });

  it("treats Capitec as matching CAPITEC BANK LIMITED", () => {
    assert.equal(valuesMatch("Capitec", "CAPITEC BANK LIMITED"), true);
  });
});

describe("parsePersonName", () => {
  it("splits Willem Aucamp and derives initials in code", () => {
    assert.deepEqual(parsePersonName("Willem Aucamp"), {
      firstName: "Willem",
      surname: "Aucamp",
      initials: "W",
      valid: true,
    });
    assert.equal(initialsFromFirstNames("Willem Christoffel"), "WC");
  });

  it("keeps middle names in first names", () => {
    const parsed = parsePersonName("Willem Christoffel Scholtz");
    assert.equal(parsed.firstName, "Willem Christoffel");
    assert.equal(parsed.surname, "Scholtz");
    assert.equal(parsed.initials, "WC");
    assert.equal(parsed.valid, true);
  });

  it("rejects a one-letter last token instead of treating it as the surname", () => {
    const parsed = parsePersonName("Willem A");
    assert.equal(parsed.valid, false);
    assert.equal(parsed.code, "NAME_MISSING_SURNAME");
    assert.equal(parsed.surname, "A");
  });
});

describe("titleFromGender", () => {
  it("maps Male to Mr and Female to Ms", () => {
    assert.equal(titleFromGender("Male").value, "Mr");
    assert.equal(titleFromGender("Female").value, "Ms");
    assert.equal(titleFromGender("").valid, false);
    assert.equal(titleFromGender("").code, "TITLE_EMPTY");
  });
});

describe("parseDurationToMmDdYyyy", () => {
  it("subtracts years from today", () => {
    const today = new Date(2026, 9, 5);
    assert.equal(parseDurationToMmDdYyyy("3 years", today), "10 05 2023");
    assert.equal(parseDurationToMmDdYyyy("6 months", today), "04 05 2026");
    assert.equal(parseDurationToMmDdYyyy("3", today), "10 05 2023");
  });
});

describe("splitNextOfKinName", () => {
  it("does not duplicate a single given name as the surname", () => {
    const parsed = splitNextOfKinName("Phuluso");
    assert.equal(parsed.valid, false);
    assert.equal(parsed.code, "NEXT_OF_KIN_MISSING_SURNAME");
    assert.equal(parsed.firstName, "Phuluso");
    assert.equal(parsed.surname, "");
  });

  it("still splits a two-word next of kin name", () => {
    assert.deepEqual(splitNextOfKinName("Phuluso Nevombe"), {
      firstName: "Phuluso",
      surname: "Nevombe",
      initials: "P",
      valid: true,
    });
  });

  it("still rejects an empty next of kin name", () => {
    assert.equal(splitNextOfKinName("").valid, false);
    assert.equal(splitNextOfKinName("").code, "NEXT_OF_KIN_EMPTY");
  });
});

describe("restorePostalCode", () => {
  it("pads a 3-digit Sheets-stripped code to 4 digits", () => {
    assert.equal(restorePostalCode("300"), "0300");
    assert.equal(restorePostalCode(300), "0300");
  });

  it("leaves a 4-digit code unchanged", () => {
    assert.equal(restorePostalCode("1685"), "1685");
  });
});

describe("restoreIdNumber", () => {
  it("prepends 0 when Sheets strips the leading digit from a 13-digit RSA ID", () => {
    assert.equal(restoreIdNumber("104205209083"), "0104205209083");
    assert.equal(restoreIdNumber(104205209083), "0104205209083");
  });

  it("leaves a 13-digit ID unchanged", () => {
    assert.equal(restoreIdNumber("9301255297080"), "9301255297080");
  });
});

describe("validateIdNumber", () => {
  it("accepts a 12-digit ID after restoring the stripped leading zero", () => {
    const result = validateIdNumber("104205209083");
    assert.equal(result.valid, true);
    assert.equal(result.value, "0104205209083");
  });

  it("still rejects IDs that are not 12 or 13 digits", () => {
    assert.equal(validateIdNumber("12345").valid, false);
    assert.equal(validateIdNumber("12345").code, "ID_NOT_13_DIGITS");
  });
});

describe("formatDateForForm", () => {
  it("converts MM DD YYYY sheet dates to DD Mon YYYY", () => {
    assert.equal(formatDateForForm("08 18 2011"), "18 Aug 2011");
    assert.equal(formatDateForForm("02 18 2015"), "18 Feb 2015");
  });

  it("converts Apps Script Date cells to the form display", () => {
    assert.equal(formatDateForForm("2021-10-05 02:00:00"), "05 Oct 2021");
  });
});

describe("validateDateFormat", () => {
  it("accepts MM DD YYYY", () => {
    const result = validateDateFormat("10 05 2021", "Residency start date", "RESIDENCY_DATE_EMPTY", "RESIDENCY_DATE_FORMAT");
    assert.equal(result.valid, true);
    assert.equal(result.value, "10 05 2021");
  });

  it("coerces Apps Script yyyy-MM-dd HH:mm:ss cells", () => {
    const result = validateDateFormat(
      "2021-10-05 02:00:00",
      "Employment start date",
      "EMPLOYMENT_DATE_EMPTY",
      "EMPLOYMENT_DATE_FORMAT"
    );
    assert.equal(result.valid, true);
    assert.equal(result.value, "10 05 2021");
  });

  it("still rejects Unknown", () => {
    const result = validateDateFormat("Unknown", "Residency start date", "RESIDENCY_DATE_EMPTY", "RESIDENCY_DATE_FORMAT");
    assert.equal(result.valid, false);
  });
});

describe("postalSearchNeedles", () => {
  it("uses place names for military-base addresses instead of 'base'", () => {
    const addr = "SAMHS training formation Thaba Tshwane military base";
    const needles = postalSearchNeedles("143", addr, "Gauteng");
    assert.ok(needles.includes("0143"));
    assert.ok(needles.includes("0143 Tshwane"));
    assert.ok(!needles.includes("base"));
    assert.ok(!needles.includes("0143 base"));
  });

  it("still extracts town before a trailing postal code in the address", () => {
    const needles = postalSearchNeedles("7580", "18 sunridge street wesbank kuilsriver 7580", "Western Cape");
    assert.ok(needles.some((n) => /7580/i.test(n) && /kuilsriver/i.test(n)));
  });

  it("treats a city/town name as a place-search needle when no 4-digit code exists", () => {
    const needles = postalSearchNeedles("Pretoria", "12 Main Road Pretoria", "Gauteng");
    assert.ok(needles[0] === "Pretoria" || needles.includes("Pretoria"));
    assert.ok(!needles.includes("2000"));
  });
});
