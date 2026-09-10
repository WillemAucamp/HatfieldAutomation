import type { WhatsAppConfig } from "../types.js";
import { normalizeSaWhatsappPhone, templateKeyForStatus } from "./phone.js";

export interface WhatsAppSendInput {
  phone: string;
  status: string;
  name?: string;
  rowIndex?: number;
}

export interface WhatsAppSendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  statusCode?: number;
  body?: string;
  requestBody?: Record<string, unknown>;
  phoneE164?: string;
  template?: string;
}

function authHeaders(config: WhatsAppConfig): Record<string, string> {
  if (!config.apiKey) return {};
  const header = config.authHeader || "Authorization";
  const scheme = config.authScheme;
  const value = scheme ? `${scheme} ${config.apiKey}` : config.apiKey;
  return { [header]: value };
}

function resolveTemplate(config: WhatsAppConfig, status: string): string | null {
  const key = templateKeyForStatus(status);
  if (!key) return null;
  return key === "approve" ? config.approveTemplate : config.declineTemplate;
}

/**
 * Build the JSON body for the user's WhatsApp API.
 *
 * Default shape:
 *   { to, template, name, status, rowIndex }
 *
 * Override with WHATSAPP_BODY_TEMPLATE JSON using placeholders:
 *   {{phone}} {{template}} {{name}} {{status}} {{rowIndex}}
 */
export function buildWhatsAppBody(
  config: WhatsAppConfig,
  input: {
    phoneE164: string;
    template: string;
    name: string;
    status: string;
    rowIndex?: number;
  }
): Record<string, unknown> {
  if (config.bodyTemplate) {
    const rendered = config.bodyTemplate
      .replaceAll("{{phone}}", input.phoneE164)
      .replaceAll("{{template}}", input.template)
      .replaceAll("{{name}}", input.name)
      .replaceAll("{{status}}", input.status)
      .replaceAll("{{rowIndex}}", input.rowIndex != null ? String(input.rowIndex) : "");
    try {
      return JSON.parse(rendered) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `WHATSAPP_BODY_TEMPLATE must be valid JSON after placeholder substitution: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const body: Record<string, unknown> = {
    [config.phoneField]: input.phoneE164,
    [config.templateField]: input.template,
    status: input.status,
  };
  if (input.name) body[config.nameField] = input.name;
  if (input.rowIndex != null) body.rowIndex = input.rowIndex;
  return body;
}

export async function sendWhatsAppMessage(
  config: WhatsAppConfig,
  input: WhatsAppSendInput,
  fetchImpl: typeof fetch = fetch
): Promise<WhatsAppSendResult> {
  if (!config.apiUrl) {
    return { ok: false, skipped: true, reason: "WHATSAPP_API_URL not set" };
  }

  const template = resolveTemplate(config, input.status);
  if (!template) {
    return {
      ok: false,
      skipped: true,
      reason: `Status "${input.status}" is not Approved/Declined`,
    };
  }

  const phoneE164 = normalizeSaWhatsappPhone(input.phone);
  if (!phoneE164) {
    return { ok: false, skipped: true, reason: `Invalid phone: ${input.phone}` };
  }

  const requestBody = buildWhatsAppBody(config, {
    phoneE164,
    template,
    name: input.name ?? "",
    status: String(input.status).trim(),
    rowIndex: input.rowIndex,
  });

  const response = await fetchImpl(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(config),
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.text().catch(() => "");
  if (!response.ok) {
    return {
      ok: false,
      statusCode: response.status,
      body: body.slice(0, 500),
      requestBody,
      phoneE164,
      template,
      reason: `WhatsApp API HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    statusCode: response.status,
    body: body.slice(0, 500),
    requestBody,
    phoneE164,
    template,
  };
}
