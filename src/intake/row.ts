import { firstFilled, joinFilled } from "./headers.js";
import { copyColumns, joinColumns } from "./mapping.js";
import type { IntakeMapping } from "./mapping.js";
import {
  isSelfEmployed,
  loadSeritiOptions,
  mapIndustry,
  mapLevel,
  mapOccupation,
} from "./seritiOptions.js";
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

/** Fix doubled domains like user@gmail.com@gmail.com from Form typos. */
export function normalizeEmail(raw: string): string {
  let value = String(raw ?? "").trim().replace(/\s+/g, "");
  const match = value.match(/^([^@]+)@([^@]+@.+)$/);
  if (!match) return value;
  const local = match[1]!;
  const rest = match[2]!;
  const parts = rest.split("@");
  if (parts.length === 2 && parts[0]!.toLowerCase() === parts[1]!.toLowerCase()) {
    return `${local}@${parts[0]}`;
  }
  // user@gmail.com@gmail.com → keep the last domain segment pair
  if (parts.length >= 2) {
    return `${local}@${parts[parts.length - 1]}`;
  }
  return value;
}

function applyStandingDefaults(
  fields: Record<string, string>,
  mapping: IntakeMapping
): void {
  const defaults = mapping.standing_defaults ?? {};
  for (const [column, value] of Object.entries(defaults)) {
    if (!(column in fields)) continue;
    if (!isMissingValue(fields[column])) continue;
    if (value === "") continue;
    fields[column] = value;
  }
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

  if (next.Email) next.Email = normalizeEmail(next.Email);

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

    const food = firstFilled(intakeValues, intakeHeadersFor(mapping, "food_spend"));
    if (food && isMissingValue(next["Food cost"])) next["Food cost"] = food;
    const cellphone = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "cellphone_spend")
    );
    if (cellphone && isMissingValue(next["Telephone payment"])) {
      next["Telephone payment"] = cellphone;
    }
    const accounts = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "accounts_spend")
    );
    if (accounts && isMissingValue(next["Transport cost"])) {
      next["Transport cost"] = accounts;
    }

    const seriti = loadSeritiOptions();
    const employment = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "employment")
    );
    const jobTitle = firstFilled(intakeValues, intakeHeadersFor(mapping, "job_title"));
    const employerName = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "employer_name")
    );

    if (isSelfEmployed(employment, jobTitle, employerName)) {
      next["Industry (AI based on employer)"] = seriti.self_employed_industry;
    } else {
      next["Industry (AI based on employer)"] = mapIndustry(
        next["Industry (AI based on employer)"] || "",
        seriti
      );
    }

    next.Occupation = mapOccupation(jobTitle || next.Occupation || "", seriti);
    next["Employee level"] = mapLevel(next["Employee level"] || "", seriti);

    // Employer province falls back to client province — not fabrication of an unknown site.
    if (isMissingValue(next["Employer province (online search)"])) {
      const province = next.Province || firstFilled(intakeValues, intakeHeadersFor(mapping, "province"));
      if (province) next["Employer province (online search)"] = province;
    }

    // When Gemini leaves postal empty, use city/town as a Seriti place-search needle.
    if (isMissingValue(next["Postal code"])) {
      const city = firstFilled(intakeValues, intakeHeadersFor(mapping, "city_town"));
      if (city) next["Postal code"] = city;
    }
  }

  for (const expense of ["Telephone payment", "Transport cost", "Food cost"]) {
    if (isMissingValue(next[expense])) next[expense] = "";
  }

  if (mapping) applyStandingDefaults(next, mapping);
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

  for (const entry of joinColumns(mapping)) {
    const joined = joinFilled(
      intakeValues,
      intakeHeadersFor(mapping, entry.source, entry.sources)
    );
    if (joined) values[entry.destination] = joined.replace(/\s*\n+\s*/g, " ").trim();
  }

  for (const [column, raw] of Object.entries(llmFields)) {
    if (!(column in values)) continue;
    const text = String(raw ?? "").replace(/\s*\n+\s*/g, " ").trim();
    if (isMissingValue(text)) continue;
    const entry = mapping.field_map.find((f) => f.destination === column);
    if (entry && (entry.mode === "copy" || entry.mode === "join")) continue;
    values[column] = text;
  }

  return applyDeterministicFixes(values, intakeValues, mapping, today);
}
