import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientJobEnv, type ClientConfig } from "./clients.js";

describe("clientJobEnv", () => {
  it("injects the client sheet id and never a blank sheet target", () => {
    const client: ClientConfig = {
      id: "acme",
      displayName: "Acme",
      enabled: true,
      sheetId: "CLIENT_SHEET_ABC",
      sheetGid: "0",
      loadedSheetId: "CLIENT_LOADED_XYZ",
    };
    const env = clientJobEnv(client);
    assert.equal(env.SHEET_ID, "CLIENT_SHEET_ABC");
    assert.equal(env.LOADED_SHEET_ID, "CLIENT_LOADED_XYZ");
    assert.match(env.SHEET_CSV_URL, /CLIENT_SHEET_ABC/);
    assert.match(env.SHEET_CSV_URL, /gviz/);
    assert.equal(env.HEADLESS, "true");
    assert.equal(env.FINANCE_URL, "https://vwmelrose.hatfieldgroup.co.za/finance");
  });

  it("clears loaded sheet when the client has none", () => {
    const env = clientJobEnv({
      id: "solo",
      displayName: "Solo",
      enabled: true,
      sheetId: "ONLY_APPLICANT",
    });
    assert.equal(env.LOADED_SHEET_ID, "");
  });
});
