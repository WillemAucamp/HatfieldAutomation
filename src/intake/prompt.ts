import type { IntakeMapping } from "./mapping.js";
import { llmColumns } from "./mapping.js";
import { formatSeritiListsForPrompt, loadSeritiOptions } from "./seritiOptions.js";

export function buildSystemPrompt(mapping: IntakeMapping, today: Date = new Date()): string {
  const columns = llmColumns(mapping);
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const year = String(today.getFullYear());
  const todayStamp = `${month} ${day} ${year}`;
  const seriti = loadSeritiOptions();

  return `[ROLE & PURPOSE]
You extract only the inferred columns listed below from one Google Form row. Do not invent names, addresses, phone numbers, ID numbers, or salary figures. Copy-mode and join-mode columns are filled in code from the Form and are not your job.

Today's date for relative calculations is ${todayStamp}.

[RULES]
- All date formats MUST be MM DD YYYY.
- Residential move-in and employment start: if "X years/months" is provided, calculate from today as MM DD YYYY. A bare number means years. Never use the ID date of birth.
- Expense amounts MUST be numeric when the Form gives a figure. Prefer the dedicated Food / Cellphone / Accounts Form columns when present. If the Form has no expenses, leave those keys empty.
- Industry and Employee level MUST be copied exactly from the Seriti lists below (character-for-character). Never invent free-text labels like "Consulting", "Entry Level", or "Manager".
- If no Industry or Level fits, leave that key "".
- Employer telephone, street, postal code, and province: leave empty in this pass if not certain. A separate google_search pass finds the employer telephone. Never copy the client's home address, postal code, province, or mobile into employer fields.
- Postal code: prefer a real South African 4-digit code for the client's city/suburb. If you cannot determine it, leave "". Never use a generic substitute code.
- Every key below must be present. Use "" when unknown. Do not output "Unknown". Do not reuse the client's first name or any other filled field as a stand-in.

[SERITI MENUS — Industry and Level must match exactly]
${formatSeritiListsForPrompt(seriti)}

[OUTPUT]
- Return a single JSON object. No markdown, no commentary, no extra keys.
- Keys MUST be exactly these ${columns.length} column headings:
${columns.map((c) => JSON.stringify(c)).join("\n")}
- Values are strings. No line breaks inside values.

[FIELD NOTES]
${mapping.field_map
  .filter((f) => f.mode === "infer")
  .map((f) => `- ${f.destination}: ${f.notes || f.mode}`)
  .join("\n")}
`;
}

export function buildUserPrompt(formText: string): string {
  return `[INPUT DATA]
The following is one Google Form response. Fill only the inferred JSON columns.

${formText}`;
}

/**
 * Brute-force google_search prompt for employer contact fields.
 * Attempt 1 is a direct business lookup; later attempts widen queries and
 * force a best-guess among search results.
 */
export function buildEmployerSearchPrompt(
  formText: string,
  seed: Record<string, string> = {},
  attempt = 1
): string {
  const priorPhone = (seed["Employer telephone number (online search)"] ?? "").trim();
  const priorStreet = (seed["Employer street address (online search)"] ?? "").trim();
  const priorPostal = (seed["Employer postal code (online search)"] ?? "").trim();
  const priorProvince = (seed["Employer province (online search)"] ?? "").trim();
  const industry = (seed["Industry (AI based on employer)"] ?? "").trim();

  const strategy =
    attempt <= 1
      ? `Search queries to try (use google_search for each until you get a phone):
1. "<employer name>" telephone / contact / "call us" South Africa
2. "<employer name>" "<city or province>" phone
3. Official website, Google Business / Maps listing, directory pages`
      : attempt === 2
        ? `Widen the search. Try alternate spellings, trading names, abbreviations, and the suburb/city.
Prefer Google Business / Maps, the company website contact page, or a major SA directory.
If several businesses share a similar name, pick the one whose city/province best matches the Form.`
        : `Final attempt — you MUST choose the most likely match from search results.
Use AI inference: employer name + job title + client city/province + industry.
If two candidates remain, prefer the one with a published landline or switchboard in that city.
Only leave the telephone empty if search genuinely returns no plausible SA business.`;

  return `[ROLE]
You are filling employer contact fields for a South African vehicle-finance application.
You have google_search. Use it. Do not invent a number that never appeared in search results.

[GOAL — ATTEMPT ${attempt}]
Find the employer telephone number for the business named on the Form.
Also fill street, postal code, and province when search shows them.
${strategy}

[HARD RULES]
- Search the business name online before answering.
- Telephone must be a real number found (or clearly listed) for that employer — South African landline or mobile, preferably 0XXXXXXXXX.
- Do NOT copy the client's personal mobile, home address, home postal code, or home province into employer fields.
- If the Form says self-employed / own business with no public listing, leave telephone "".
- Prefer switchboard / main contact numbers over personal staff mobiles when both appear.
- Return ONLY a JSON object (no markdown, no commentary).

[PRIOR INFERENCE — may be empty or wrong; search overrides]
- Industry: ${JSON.stringify(industry)}
- Employer telephone: ${JSON.stringify(priorPhone)}
- Employer street: ${JSON.stringify(priorStreet)}
- Employer postal code: ${JSON.stringify(priorPostal)}
- Employer province: ${JSON.stringify(priorProvince)}

[OUTPUT KEYS — exactly these four]
{
  "Employer telephone number (online search)": "",
  "Employer street address (online search)": "",
  "Employer postal code (online search)": "",
  "Employer province (online search)": ""
}

[FORM ROW]
${formText}
`;
}
