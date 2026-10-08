import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadIntakeMapping } from "./mapping.js";
import { matchIntakeRow } from "./matchIntake.js";

const mapping = loadIntakeMapping("./config/intake-mapping.yaml");

describe("matchIntakeRow", () => {
  const auto = {
    Email: "Samuelkgabomojela@gmail.com",
    "Full name": "Kgabo Samuel mojela",
    "ID number": "",
  };

  const oldLeak = {
    rowIndex: 209,
    values: {
      Email: "Samuelkgabomojela@gmail.com",
      "Name and surname": "Kgabo Samuel mojela",
      "ID Number": "Yes",
      "Enrichment Status": "skipped_already_loaded",
    },
  };

  const good = {
    rowIndex: 301,
    values: {
      Email: "Samuelkgabomojela@gmail.com",
      "Name and surname": "Kgabo Samuel mojela",
      "ID Number": "8603206249081",
      "Enrichment Status": "enriched row 344 nr 345",
    },
  };

  it("prefers the Form row linked by Enrichment Status over an older Yes-ID leak", () => {
    const hit = matchIntakeRow(auto, [oldLeak, good], mapping, 344);
    assert.equal(hit?.rowIndex, 301);
    assert.equal(hit?.values["ID Number"], "8603206249081");
  });

  it("prefers a usable RSA ID when Enrichment Status is absent", () => {
    const unmarked = {
      ...good,
      values: { ...good.values, "Enrichment Status": "" },
    };
    const hit = matchIntakeRow(auto, [oldLeak, unmarked], mapping, 344);
    assert.equal(hit?.rowIndex, 301);
  });
});
