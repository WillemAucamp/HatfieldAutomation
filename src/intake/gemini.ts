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

export async function enrichWithGemini(
  mapping: IntakeMapping,
  formText: string,
  options: GeminiClientOptions
): Promise<Record<string, string>> {
  if (!options.apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent`;
  const attempts: Array<Record<string, unknown>> = [
    {
      contents: [
        {
          role: "user",
          parts: [{ text: `${buildSystemPrompt(mapping)}\n\n${buildUserPrompt(formText)}` }],
        },
      ],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    },
    {
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
    },
  ];

  let lastError = "Gemini returned an empty response";
  for (const body of attempts) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": options.apiKey,
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as GeminiResponse;
    if (!response.ok || json.error) {
      lastError = json.error?.message || `Gemini HTTP ${response.status}`;
      continue;
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      lastError = "Gemini returned an empty response";
      continue;
    }
    try {
      return coerceLlmFields(extractJsonObject(text), mapping);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}
