import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { IntakeMapping } from "./mapping.js";
import { llmColumns } from "./mapping.js";

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string; status?: string };
}

export function extractJsonObject(text: string): Record<string, string> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini JSON must be an object of column headings");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[key] = value == null ? "" : String(value).replace(/\s*\n+\s*/g, " ").trim();
  }
  return out;
}

export function coerceLlmFields(
  raw: Record<string, string>,
  mapping: IntakeMapping
): Record<string, string> {
  const columns = llmColumns(mapping);
  const normalized = new Map(
    Object.entries(raw).map(([key, value]) => [key.trim().toLowerCase(), value])
  );
  const fields: Record<string, string> = {};
  const missing: string[] = [];
  for (const column of columns) {
    const value = raw[column] ?? normalized.get(column.toLowerCase());
    if (value == null || value === "") {
      missing.push(column);
      fields[column] = "";
    } else {
      fields[column] = value;
    }
  }
  if (missing.length === columns.length) {
    throw new Error(`Gemini returned none of the required columns. Keys: ${Object.keys(raw).join(", ")}`);
  }
  return fields;
}

export function employerSearchColumns(mapping: IntakeMapping): string[] {
  return mapping.destination_columns.filter((column) => /\(online search\)/i.test(column));
}

export function needsEmployerSearch(
  fields: Record<string, string>,
  mapping: IntakeMapping
): boolean {
  return employerSearchColumns(mapping).some((column) => {
    const value = (fields[column] ?? "").trim();
    return !value || /^unknown$/i.test(value);
  });
}

function requestBody(
  mapping: IntakeMapping,
  formText: string,
  useSearch: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${buildSystemPrompt(mapping)}\n\n${buildUserPrompt(formText)}` }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };
  if (useSearch) {
    body.tools = [{ google_search: {} }];
  }
  return body;
}

async function generateOnce(
  mapping: IntakeMapping,
  formText: string,
  options: GeminiClientOptions,
  useSearch: boolean
): Promise<{ fields?: Record<string, string>; error: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey,
    },
    body: JSON.stringify(requestBody(mapping, formText, useSearch)),
  });
  const json = (await response.json()) as GeminiResponse;
  if (!response.ok || json.error) {
    return { error: json.error?.message || `Gemini HTTP ${response.status}` };
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    return { error: "Gemini returned an empty response" };
  }
  try {
    return { fields: coerceLlmFields(extractJsonObject(text), mapping), error: "" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function enrichWithGemini(
  mapping: IntakeMapping,
  formText: string,
  options: GeminiClientOptions
): Promise<Record<string, string>> {
  if (!options.apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  // Web search is ~1 min/row. Try without it first; only search when employer fields are empty.
  console.log("Gemini: formatting without web search…");
  const first = await generateOnce(mapping, formText, options, false);
  if (first.fields && !needsEmployerSearch(first.fields, mapping)) {
    return first.fields;
  }
  if (first.fields) {
    console.log("Gemini: employer fields still empty/Unknown — retrying with web search…");
  } else {
    console.log(`Gemini: first attempt failed (${first.error}) — retrying with web search…`);
  }

  const second = await generateOnce(mapping, formText, options, true);
  if (second.fields) return second.fields;
  throw new Error(second.error || first.error || "Gemini returned an empty response");
}
