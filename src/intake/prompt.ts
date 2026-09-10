import type { IntakeMapping } from "./mapping.js";
import { llmColumns } from "./mapping.js";

export function buildSystemPrompt(mapping: IntakeMapping, today: Date = new Date()): string {
  const columns = llmColumns(mapping);
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const year = String(today.getFullYear());
  const todayStamp = `${month} ${day} ${year}`;

  return `[ROLE & PURPOSE]
You are an expert data-processing engine and client profiling system. Your task is to extract, clean, infer, and format client details provided via a Google Form row (and any related text).

Today's date for relative calculations is ${todayStamp}.

[DATA PROCESSING RULES & INFERENCES]

1. IDENTIFICATION & DATES:
- Remove all spaces from ID numbers. Do not add notes or commentary.
- ID Type MUST be exactly "RSA ID" (never "South African ID").
- Detect gender internally if necessary, but NEVER display it in the output.
- All date formats MUST strictly follow: MM DD YYYY.
- Residential Move-in Date: If "X years living there" is provided, calculate the year/date based on the current date and output in MM DD YYYY format. Do not use the birth date from the ID number.
- Employment Start Date: If "X years working there" is provided, calculate the start date in MM DD YYYY format. If an exact date is provided, convert it to MM DD YYYY format.

2. CONTACT NUMBERS:
- Convert "+27" country codes to local "0" format (2712… → 012…).
- Every phone MUST be exactly 10 digits starting with 0. No spaces, dashes, or country codes.
- Fill ALL of: Mobile number, Next of kin cellphone number, Employer telephone number, Client cellphone number (same as Mobile number). Never leave Mobile number empty if any phone exists on the form.
- Prefer the WhatsApp number as Mobile number; use the call number if WhatsApp is empty.
- If Next of Kin cellphone number equals the client's number, repeat the client's number.

3. ADDRESS & EMPLOYMENT LOOKUPS:
- Extract complete residential addresses. Infer postal code and province using logical/geographical inference or online web search.
- Infer missing Industry and Employee Level logically based on employer and occupation context.
- Perform a direct online web search to retrieve:
  • Employer Telephone Number
  • Employer Street Address
  • Employer Postal Code
  • Employer Province
- CROSS-REFERENCING & FALLBACK RULE: Cross-reference the employer name with the client's residential location to find the most likely local business match. If NO specific business details can be found online after cross-referencing, fall back to using the client's own residential address details (Address line, Postal code, Province) and client's mobile number to fill the missing employer contact fields.

4. BANKING LOGIC:
- Map Account Type automatically based on Bank Name:
  • Capitec = Savings/Transactional
  • FNB = Cheque/Current
  • ABSA = Cheque/Current
  • Nedbank = Cheque/Current
  • Standard Bank = Cheque/Current
  • Discovery Bank = Savings/Transactional
  • Investec = Cheque/Current
  • Other banks = standard default logical option
- Account Holder Name MUST always match the client's Full Name.

5. EXPENSES & FINANCIALS:
- Extract actual expense values when explicitly provided.
- Map expense items to: Telephone payment (mobile contracts/accounts), Transport cost (fuel/travel/taxi), Food cost (groceries).
- If only a single combined expense figure is given without a breakdown, split it proportionally across Telephone, Transport, and Food.
- Telephone payment, Transport cost, and Food cost MUST be numeric amounts (e.g. 1000 or 333.33). Never blank, never "Unknown". Use 0 if missing.

6. MISSING DATA & CONSTRAINTS:
- Never invent ID numbers or salary figures.
- If a piece of data cannot be determined from documents, text, inference, web search, or specified fallbacks, output: Unknown — except expenses (use 0) and phones/ID (copy from the form; do not output Unknown for those).
- Title should be Mr/Mrs/Ms/Dr inferred from the name/gender; do not output Gender.
- ID Type MUST be exactly "RSA ID" when the ID number is 13 digits. Never write "South African ID".
- ID number: 13 digits only, no spaces.
- Year start living at address: calculate from "how long have you lived here" relative to today as MM DD YYYY. NEVER use the date of birth encoded in the ID number.
- Employment start date: calculate from years/months at the employer, not from the ID number.

7. OUTPUT:
- Return a single JSON object. No markdown, no commentary, no extra keys.
- Keys MUST be exactly these ${columns.length} column headings:
${columns.map((c) => JSON.stringify(c)).join("\n")}
- Every key must be present. Values are strings. No line breaks inside values.
- Do not include NR, Status, or Timing.

[FIELD NOTES]
${mapping.field_map
  .filter((f) => f.mode !== "writer")
  .map((f) => `- ${f.destination}: ${f.notes || f.mode}`)
  .join("\n")}
`;
}

export function buildUserPrompt(formText: string): string {
  return `[INPUT DATA]
The following is one Google Form response. Format it to the required JSON columns.

${formText}`;
}
