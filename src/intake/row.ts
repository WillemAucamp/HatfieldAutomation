import { firstFilled } from "./headers.js";
import { copyColumns } from "./mapping.js";
import type { IntakeMapping } from "./mapping.js";
import { parseExpenseSummary } from "./expenses.js";
import {
  isMissingValue,
  parseDurationToMmDdYyyy,
  titleFromGender,
  transformMobile,
  validateIdNumber,
} from "../transforms.js";

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
  return bank.trim() ? "Cheque/Current" : "";
}

function intakeHeadersFor(
  mapping: IntakeMapping,
  source?: string,
  sources?: string[]
): string[] {
  const keys = sources ?? (source ? [source] : []);
  return keys.map((key) => mapping.intake_headers[key] || key);
}

export function applyDeterministicFixes(
  fields: Record<string, string>,
  intakeValues: Record<string, string> = {},
  mapping?: IntakeMapping,
  today: Date = new Date()
): Record<string, string> {
  const next = { ...fields };
  const name =
    (mapping
      ? firstFilled(intakeValues, intakeHeadersFor(mapping, "name_and_surname"))
      : "") ||
    next["Full name"] ||
    next["First names + surname"] ||
    "";
  if (name) {
    next["Full name"] = name;
    next["First names + surname"] = name;
    next["Account holder name and surname (same as client)"] = name;
  }

  const gender = mapping
    ? firstFilled(intakeValues, intakeHeadersFor(mapping, "gender"))
    : next.Title;
  const title = titleFromGender(gender);
  if (title.valid) next.Title = title.value;

  const bank = next["Bank name"] ?? "";
  if (bank) {
    next["Account type (AI—most likely option based on bank)"] = accountTypeForBank(bank);
  }

  const mobile =
    next["Mobile number"] || next["Client cellphone number (add again at the end)"] || "";
  const mobileResult = transformMobile(mobile);
  if (mobileResult.valid) {
    next["Mobile number"] = mobileResult.value;
    next["Client cellphone number (add again at the end)"] = mobileResult.value;
  } else if (mobile && !isMissingValue(mobile)) {
    next["Mobile number"] = mobile;
    next["Client cellphone number (add again at the end)"] = mobile;
  }

  const idResult = validateIdNumber(next["ID number"]);
  if (idResult.valid) {
    next["ID number"] = idResult.value;
    next["ID Type"] = "RSA ID";
  } else if (/south african/i.test(next["ID Type"] ?? "")) {
    next["ID Type"] = "RSA ID";
  }

  if (mapping) {
    const lived = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "years_at_address")
    );
    const livedDate = parseDurationToMmDdYyyy(lived, today);
    if (livedDate) {
      next["Year start living at address (MM DD YYYY format ONLY)"] = livedDate;
    }
    const employed = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "years_at_employer")
    );
    const employedDate = parseDurationToMmDdYyyy(employed, today);
    if (employedDate) {
      next["Year they started working there (calculate from years provided)"] = employedDate;
    }
  }

  if (mapping) {
    const nokName = firstFilled(intakeValues, intakeHeadersFor(mapping, "next_of_kin_name"));
    const nokSurname = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "next_of_kin_surname")
    );
    const nokCombined = [nokName, nokSurname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (nokCombined) next["Next of kin name + Surname"] = nokCombined;

    const foodSpend = firstFilled(intakeValues, intakeHeadersFor(mapping, "expense_food"));
    if (foodSpend && !isMissingValue(foodSpend)) next["Food cost"] = foodSpend.replace(/[^\d.]/g, "") || foodSpend;

    const phoneSpend = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "expense_cellphone")
    );
    if (phoneSpend && !isMissingValue(phoneSpend)) {
      next["Telephone payment"] = phoneSpend.replace(/[^\d.]/g, "") || phoneSpend;
    }

    const summary = firstFilled(intakeValues, intakeHeadersFor(mapping, "expenses_summary"));
    const parsed = parseExpenseSummary(summary);
    if ((!next["Food cost"] || isMissingValue(next["Food cost"])) && parsed.food) {
      next["Food cost"] = parsed.food;
    }
    if (
      (!next["Telephone payment"] || isMissingValue(next["Telephone payment"])) &&
      parsed.telephone
    ) {
      next["Telephone payment"] = parsed.telephone;
    }
    if (
      (!next["Transport cost"] || isMissingValue(next["Transport cost"])) &&
      parsed.transport
    ) {
      next["Transport cost"] = parsed.transport;
    }
  }

  for (const expense of ["Telephone payment", "Transport cost", "Food cost"]) {
    if (isMissingValue(next[expense])) next[expense] = "";
  }
  return next;
}

export function buildOutputValues(
  mapping: IntakeMapping,
  llmFields: Record<string, string>,
  intakeValues: Record<string, string> = {},
  today: Date = new Date()
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const column of mapping.destination_columns) {
    if (column === "NR") continue;
    if (column === "Status" || column === "Timing") {
      values[column] = "";
      continue;
    }
    values[column] = "";
  }

  for (const entry of copyColumns(mapping)) {
    const copied = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, entry.source, entry.sources)
    );
    if (copied) values[entry.destination] = copied.replace(/\s*\n+\s*/g, " ").trim();
  }

  for (const [column, raw] of Object.entries(llmFields)) {
    if (!(column in values)) continue;
    const text = String(raw ?? "").replace(/\s*\n+\s*/g, " ").trim();
    if (isMissingValue(text)) continue;
    const entry = mapping.field_map.find((f) => f.destination === column);
    if (entry && entry.mode === "copy") continue;
    values[column] = text;
  }

  return applyDeterministicFixes(values, intakeValues, mapping, today);
}
