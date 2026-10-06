import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstUsableSelectOption,
  formatMissingOptionError,
  pickSelectOption,
} from "./selectMatch.js";

const banks = [
  { value: "", text: "......" },
  { value: "1", text: "FIRSTRAND BANK LIMITED" },
  { value: "2", text: "CAPITEC BANK LIMITED" },
  { value: "3", text: "STANDARD BANK OF SOUTH AFRICA" },
];

describe("pickSelectOption", () => {
  it("maps FNB to FIRSTRAND", () => {
    assert.equal(pickSelectOption(banks, "FNB")?.text, "FIRSTRAND BANK LIMITED");
  });

  it("maps Capitec nicknames", () => {
    assert.equal(pickSelectOption(banks, "Capitec")?.text, "CAPITEC BANK LIMITED");
  });

  it("returns null when nothing is close", () => {
    assert.equal(pickSelectOption(banks, "Bank Zero"), null);
  });

  it("matches Matric against Grade 12 aliases", () => {
    const education = [
      { value: "1", text: "Grade 12" },
      { value: "2", text: "Diploma" },
    ];
    assert.equal(pickSelectOption(education, "Matric certificate")?.text, "Grade 12");
  });

  it("matches Business services against a longer industry label", () => {
    const industries = [
      { value: "1", text: "Agriculture" },
      { value: "2", text: "BUSINESS SERVICES SECTOR" },
    ];
    assert.equal(pickSelectOption(industries, "Business services")?.text, "BUSINESS SERVICES SECTOR");
  });

  it("maps Automotive sheet labels onto Seriti industry options", () => {
    const industries = [
      { value: "1", text: "ADVERTISING" },
      { value: "2", text: "BUSINESS SERVICES" },
      { value: "3", text: "MOTOR TRADE" },
      { value: "4", text: "TRANSPORT" },
    ];
    assert.equal(pickSelectOption(industries, "Automotive")?.text, "MOTOR TRADE");
  });

  it("maps Associate job titles onto Seriti occupation options", () => {
    const occupations = [
      { value: "1", text: "ACTOR" },
      { value: "2", text: "ADMINISTRATIVE PERSONNEL" },
      { value: "3", text: "AGENT" },
    ];
    assert.equal(pickSelectOption(occupations, "Associate")?.text, "ADMINISTRATIVE PERSONNEL");
  });
});

describe("firstUsableSelectOption", () => {
  it("skips the placeholder", () => {
    assert.equal(firstUsableSelectOption(banks)?.text, "FIRSTRAND BANK LIMITED");
  });
});

describe("formatMissingOptionError", () => {
  it("names the field and lists real options", () => {
    const message = formatMissingOptionError("Bank", "Bank Zero", banks);
    assert.match(message, /in Bank/);
    assert.match(message, /Bank Zero/);
    assert.match(message, /CAPITEC BANK LIMITED/);
    assert.doesNotMatch(message, /\.\.\.\.\.\./);
  });
});
