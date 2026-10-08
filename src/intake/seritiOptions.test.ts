import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSelfEmployed,
  loadSeritiOptions,
  mapIndustry,
  mapLevel,
  mapOccupation,
} from "./seritiOptions.js";

describe("seriti option mapping", () => {
  const options = loadSeritiOptions();

  it("loads Willem's Industry aliases onto exact Seriti strings", () => {
    assert.equal(mapIndustry("Consulting", options), "BUSINESS SERVICES");
    assert.equal(mapIndustry("Plumbing", options), "COMMUNITY SERVICES");
    assert.equal(mapIndustry("Logistics", options), "TRANSPORT");
    assert.equal(mapIndustry("Healthcare", options), "HEALTH");
    assert.equal(mapIndustry("RETAIL", options), "RETAIL");
  });

  it("maps Level free text onto Seriti Level menu", () => {
    assert.equal(mapLevel("Manager", options), "MANAGEMENT");
    assert.equal(mapLevel("Entry Level", options), "JUNIOR POSITION");
    assert.equal(mapLevel("Entry level", options), "JUNIOR POSITION");
    assert.equal(mapLevel("Mid Level", options), "SKILLED WORKER");
    assert.equal(mapLevel("Executive", options), "SENIOR MANAGEMENT");
    assert.equal(mapLevel("skilled", options), "SKILLED WORKER");
    assert.equal(mapLevel("Operational", options), "SKILLED WORKER");
    assert.equal(mapLevel("Employee", options), "SKILLED WORKER");
    assert.equal(mapLevel("not-a-real-level", options), "SKILLED WORKER");
  });

  it("maps Occupation job titles and falls back to LABOURER (SKILLED)", () => {
    assert.equal(mapOccupation("Clerk", options), "CLERK");
    assert.equal(mapOccupation("plumber", options), "PLUMBER");
    assert.equal(mapOccupation("Warehouse picker", options), "LABOURER (SKILLED)");
    assert.equal(mapOccupation("", options), "LABOURER (SKILLED)");
    assert.equal(mapOccupation("RDT operator", options), "OPERATOR");
    assert.equal(mapOccupation("Loan consultant", options), "CONSULTANT");
    assert.equal(mapOccupation("Truck driver", options), "DRIVER");
  });

  it("detects self-employed Employment answers", () => {
    assert.equal(isSelfEmployed("Self-employed"), true);
    assert.equal(isSelfEmployed("Permanently Employed with payslips"), false);
  });
});
