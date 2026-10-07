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
- Employer telephone, street, postal code, and province may be inferred from employer + location. If you cannot determine them, leave them empty. Do not copy the client's home address, postal code, province, or mobile into employer fields.
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
