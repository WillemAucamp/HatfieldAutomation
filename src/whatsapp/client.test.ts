import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWhatsAppBody, resolveWhatsAppApiUrl, sendWhatsAppMessage } from "./client.js";
import type { WhatsAppConfig } from "../types.js";

const metaConfig: WhatsAppConfig = {
  provider: "meta",
  apiUrl: "",
  graphVersion: "v21.0",
  phoneNumberId: "1234567890",
  apiKey: "secret",
  authHeader: "Authorization",
  authScheme: "Bearer",
  approveTemplate: "lead_approved",
  declineTemplate: "lead_declined",
  templateLanguage: "en",
  includeNameParameter: false,
  phoneField: "to",
  templateField: "template",
  nameField: "name",
  bodyTemplate: "",
};

const customConfig: WhatsAppConfig = {
  ...metaConfig,
  provider: "custom",
  apiUrl: "https://whatsapp.example/send",
  phoneNumberId: "",
};

describe("resolveWhatsAppApiUrl", () => {
  it("builds Meta Graph messages URL from phone number id", () => {
    assert.equal(
      resolveWhatsAppApiUrl(metaConfig),
      "https://graph.facebook.com/v21.0/1234567890/messages"
    );
  });

  it("prefers explicit WHATSAPP_API_URL", () => {
    assert.equal(
      resolveWhatsAppApiUrl({ ...metaConfig, apiUrl: "https://example/messages" }),
      "https://example/messages"
    );
  });
});

describe("buildWhatsAppBody", () => {
  it("builds Meta Cloud API template payload", () => {
    assert.deepEqual(
      buildWhatsAppBody(metaConfig, {
        phoneE164: "27821234567",
        template: "lead_approved",
        name: "Ada",
        status: "Approved",
        rowIndex: 4,
      }),
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "27821234567",
        type: "template",
        template: {
          name: "lead_approved",
          language: { code: "en" },
        },
      }
    );
  });

  it("adds name as body parameter when enabled", () => {
    const body = buildWhatsAppBody(
      { ...metaConfig, includeNameParameter: true },
      {
        phoneE164: "27821234567",
        template: "lead_approved",
        name: "Ada",
        status: "Approved",
      }
    );
    assert.deepEqual((body.template as { components: unknown }).components, [
      { type: "body", parameters: [{ type: "text", text: "Ada" }] },
    ]);
  });

  it("uses custom field names for provider=custom", () => {
    assert.deepEqual(
      buildWhatsAppBody(customConfig, {
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
      ...metaConfig,
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
  it("POSTs Meta template JSON with Bearer auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"messages":[{"id":"wamid.TEST"}]}', { status: 200 });
    };

    const result = await sendWhatsAppMessage(
      metaConfig,
      { phone: "0821234567", status: "Approved", name: "Ada", rowIndex: 2 },
      fetchImpl
    );

    assert.equal(result.ok, true);
    assert.equal(result.phoneE164, "27821234567");
    assert.equal(result.template, "lead_approved");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/1234567890/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer secret");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "27821234567",
      type: "template",
      template: {
        name: "lead_approved",
        language: { code: "en" },
      },
    });
  });

  it("skips when Meta phone number id missing", async () => {
    const result = await sendWhatsAppMessage(
      { ...metaConfig, phoneNumberId: "", apiUrl: "" },
      { phone: "0821234567", status: "Approved" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
  });
});
