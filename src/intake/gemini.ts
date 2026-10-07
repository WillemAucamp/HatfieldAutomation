import { buildEmployerSearchPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { IntakeMapping } from "./mapping.js";
import { llmColumns } from "./mapping.js";
import { isMissingValue, transformMobile } from "../transforms.js";

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Max google_search attempts for employer phone (default 3). */
  employerSearchAttempts?: number;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string; status?: string };
}

const EMPLOYER_PHONE_COLUMN = "Employer telephone number (online search)";

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

/** True when Seriti-required employer telephone is still missing / invalid. */
export function needsEmployerPhone(fields: Record<string, string>): boolean {
  const raw = fields[EMPLOYER_PHONE_COLUMN] ?? "";
  if (isMissingValue(raw) || /^unknown$/i.test(raw)) return true;
  return !transformMobile(raw).valid;
}

/**
 * Pull a South African landline/mobile out of messy search text and normalise
 * to 0XXXXXXXXX when possible.
 */
export function normalizeEmployerPhone(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text || /^unknown$/i.test(text)) return "";

  const candidates: string[] = [];
  const plus27 = text.match(/\+?27[\s()-]*(\d[\d\s()-]{7,12}\d)/g) ?? [];
  for (const match of plus27) candidates.push(match);
  const local = text.match(/0\d[\d\s()-]{7,12}\d/g) ?? [];
  for (const match of local) candidates.push(match);
  if (!candidates.length) candidates.push(text);

  for (const candidate of candidates) {
    const result = transformMobile(candidate);
    if (result.valid) return result.value;
  }
  // Keep digits-only landline-shaped values even if transformMobile rejected spacing.
  const digits = text.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("27")) {
    const localDigits = `0${digits.slice(2)}`;
    if (localDigits.length === 10) return localDigits;
  }
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return "";
}

function mergeEmployerFields(
  base: Record<string, string>,
  found: Record<string, string>,
  mapping: IntakeMapping
): Record<string, string> {
  const next = { ...base };
  for (const column of employerSearchColumns(mapping)) {
    const incoming = found[column] ?? "";
    if (isMissingValue(incoming) || /^unknown$/i.test(incoming)) continue;
    if (column === EMPLOYER_PHONE_COLUMN) {
      const phone = normalizeEmployerPhone(incoming);
      if (phone) next[column] = phone;
      continue;
    }
    if (isMissingValue(next[column]) || /^unknown$/i.test(next[column] ?? "")) {
      next[column] = incoming;
    }
  }
  return next;
}

function requestBody(
  mapping: IntakeMapping,
  formText: string,
  extras: { googleSearch?: boolean; promptOverride?: string } = {}
): Record<string, unknown> {
  const prompt =
    extras.promptOverride ??
    `${buildSystemPrompt(mapping)}\n\n${buildUserPrompt(formText)}`;
  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: extras.googleSearch ? 0.2 : 0.1,
      // google_search grounding is unreliable with forced JSON mime on some models.
      ...(extras.googleSearch ? {} : { responseMimeType: "application/json" }),
    },
  };
  if (extras.googleSearch) {
    body.tools = [{ google_search: {} }];
  }
  return body;
}

async function generateOnce(
  mapping: IntakeMapping,
  formText: string,
  options: GeminiClientOptions,
  extras: { googleSearch?: boolean; promptOverride?: string } = {}
): Promise<{ fields?: Record<string, string>; error: string; rawText?: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey,
    },
    body: JSON.stringify(requestBody(mapping, formText, extras)),
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
    if (extras.googleSearch) {
      // Search pass returns a small JSON object (employer columns only).
      const parsed = extractJsonObject(text);
      return { fields: parsed, error: "", rawText: text };
    }
    return { fields: coerceLlmFields(extractJsonObject(text), mapping), error: "", rawText: text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), rawText: text };
  }
}

/**
 * Brute-force employer online search: google_search + retries until a usable
 * telephone is found (or attempts are exhausted).
 */
export async function enrichEmployerWithSearch(
  mapping: IntakeMapping,
  formText: string,
  options: GeminiClientOptions,
  seed: Record<string, string> = {}
): Promise<Record<string, string>> {
  const attempts = Math.max(1, options.employerSearchAttempts ?? 3);
  let fields = { ...seed };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!needsEmployerPhone(fields) && !needsEmployerSearch(fields, mapping)) {
      return fields;
    }
    console.log(`Gemini: employer google_search attempt ${attempt}/${attempts}…`);
    const prompt = buildEmployerSearchPrompt(formText, fields, attempt);
    const result = await generateOnce(mapping, formText, options, {
      googleSearch: true,
      promptOverride: prompt,
    });
    if (!result.fields) {
      console.warn(`  employer search attempt ${attempt} failed: ${result.error}`);
      continue;
    }
    fields = mergeEmployerFields(fields, result.fields, mapping);
    const phone = fields[EMPLOYER_PHONE_COLUMN] ?? "";
    console.log(
      `  employer search attempt ${attempt}: phone=${phone ? phone : "(empty)"}`
    );
    if (!needsEmployerPhone(fields)) {
      return fields;
    }
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

  console.log("Gemini: formatting inferred columns…");
  const result = await generateOnce(mapping, formText, options);
  if (!result.fields) {
    throw new Error(result.error || "Gemini returned an empty response");
  }

  let fields = result.fields;
  if (needsEmployerPhone(fields) || needsEmployerSearch(fields, mapping)) {
    fields = await enrichEmployerWithSearch(mapping, formText, options, fields);
  }

  // Normalise any phone the first pass already returned.
  if (!isMissingValue(fields[EMPLOYER_PHONE_COLUMN] ?? "")) {
    const phone = normalizeEmployerPhone(fields[EMPLOYER_PHONE_COLUMN] ?? "");
    if (phone) fields[EMPLOYER_PHONE_COLUMN] = phone;
  }

  return fields;
}
