import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWhatsAppBody, sendWhatsAppMessage } from "./client.js";
import type { WhatsAppConfig } from "../types.js";

const baseConfig: WhatsAppConfig = {
  apiUrl: "https://whatsapp.example/send",
  apiKey: "secret",
  authHeader: "Authorization",
  authScheme: "Bearer",
  approveTemplate: "lead_approved",
  declineTemplate: "lead_declined",
  phoneField: "to",
  templateField: "template",
  nameField: "name",
  bodyTemplate: "",
};

describe("buildWhatsAppBody", () => {
  it("uses default field names", () => {
    assert.deepEqual(
      buildWhatsAppBody(baseConfig, {
        phoneE164: "27821234567",
        template: "lead_approved",
        name: "Ada",
        status: "Approved",
        rowIndex: 4,
      }),
      {
        to: "27821234567",
        template: "lead_approved",
        status: "Approved",
        name: "Ada",
        rowIndex: 4,
      }
    );
  });

  it("renders WHATSAPP_BODY_TEMPLATE placeholders", () => {
    const config = {
      ...baseConfig,
      bodyTemplate: '{"msisdn":"{{phone}}","msg":"{{template}}","who":"{{name}}"}',
    };
    assert.deepEqual(
      buildWhatsAppBody(config, {
        phoneE164: "27821234567",
        template: "lead_declined",
        name: "Bob",
        status: "Declined",
      }),
      { msisdn: "27821234567", msg: "lead_declined", who: "Bob" }
    );
  });
});

describe("sendWhatsAppMessage", () => {
  it("POSTs JSON with Bearer auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"ok":true}', { status: 200 });
    };

    const result = await sendWhatsAppMessage(
      baseConfig,
      { phone: "0821234567", status: "Approved", name: "Ada", rowIndex: 2 },
      fetchImpl
    );

    assert.equal(result.ok, true);
    assert.equal(result.phoneE164, "27821234567");
    assert.equal(result.template, "lead_approved");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, baseConfig.apiUrl);
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer secret");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      to: "27821234567",
      template: "lead_approved",
      status: "Approved",
      name: "Ada",
      rowIndex: 2,
    });
  });

  it("skips when URL missing", async () => {
    const result = await sendWhatsAppMessage(
      { ...baseConfig, apiUrl: "" },
      { phone: "0821234567", status: "Approved" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
  });
});
