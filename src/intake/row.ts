import type { IntakeMapping } from "./mapping.js";

const BANK_ACCOUNT_TYPE: Record<string, string> = {
  capitec: "Savings/Transactional",
  fnb: "Cheque/Current",
  "first national": "Cheque/Current",
  firstrand: "Cheque/Current",
  absa: "Cheque/Current",
  nedbank: "Cheque/Current",
  "standard bank": "Cheque/Current",
  discovery: "Savings/Transactional",
  investec: "Cheque/Current",
};

export function accountTypeForBank(bank: string): string {
  const n = bank.toLowerCase();
  for (const [needle, value] of Object.entries(BANK_ACCOUNT_TYPE)) {
    if (n.includes(needle)) return value;
  }
  return bank.trim() ? "Cheque/Current" : "Unknown";
}

export function applyDeterministicFixes(fields: Record<string, string>): Record<string, string> {
  const next = { ...fields };
  const bank = next["Bank name"] ?? "";
  if (bank && (!next["Account type (AI—most likely option based on bank)"] || next["Account type (AI—most likely option based on bank)"] === "Unknown")) {
    next["Account type (AI—most likely option based on bank)"] = accountTypeForBank(bank);
  }
  const fullName = next["Full name"] || next["First names + surname"] || "";
  if (fullName) {
    next["Account holder name and surname (same as client)"] = fullName;
    if (!next["First names + surname"]) next["First names + surname"] = fullName;
    if (!next["Full name"]) next["Full name"] = fullName;
  }
  const mobile = next["Mobile number"] || next["Client cellphone number (add again at the end)"] || "";
  if (mobile) {
    next["Mobile number"] = mobile;
    next["Client cellphone number (add again at the end)"] = mobile;
  }
  for (const expense of ["Telephone payment", "Transport cost", "Food cost"]) {
    if (!String(next[expense] ?? "").trim()) next[expense] = "0";
  }
  return next;
}

export function buildOutputValues(
  mapping: IntakeMapping,
  llmFields: Record<string, string>
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const column of mapping.destination_columns) {
    if (column === "NR") continue;
    if (column === "Status" || column === "Timing") {
      values[column] = "";
      continue;
    }
    values[column] = String(llmFields[column] ?? "").replace(/\s*\n+\s*/g, " ").trim();
  }
  return applyDeterministicFixes(values);
}
