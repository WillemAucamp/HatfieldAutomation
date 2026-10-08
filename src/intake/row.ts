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
  coerceToMmDdYyyy,
  isMissingValue,
  normalizeExpenseAmount,
  parseDurationToMmDdYyyy,
  restorePostalCode,
  titleFromGender,
  transformMobile,
  usableIdDigits,
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

const DATE_COLUMNS = [
  "Year start living at address (MM DD YYYY format ONLY)",
  "Year they started working there (calculate from years provided)",
] as const;

const EXPENSE_COLUMNS = ["Telephone payment", "Transport cost", "Food cost"] as const;

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

function protectPostal(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value || isMissingValue(value)) return "";
  // City/town needles stay as text for Seriti place search.
  if (/[A-Za-z]/.test(value) && !/^\d+$/.test(value.replace(/\s/g, ""))) {
    return value;
  }
  return restorePostalCode(value);
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

  // RSA ID type is always set for this Form; never leave Gemini free text here.
  next["ID Type"] = "RSA ID";

  // Form answers like "Married in community of property" must map to a Seriti
  // marital option. Keep Married/Single/Divorced/Widowed; collapse COP wording
  // to Married so Seriti does not open COP-only fields we cannot fill from Form.
  {
    const marital = String(next["Marital status"] || "").trim();
    if (/married/i.test(marital) && /community of property|anc|cop\b/i.test(marital)) {
      next["Marital status"] = "Married";
    }
  }
  // Never keep Form leaks like consent "Yes" in the ID column.
  {
    const currentUsable = usableIdDigits(next["ID number"]);
    const formId = mapping
      ? usableIdDigits(firstFilled(intakeValues, intakeHeadersFor(mapping, "id_number")))
      : "";
    if (currentUsable) {
      next["ID number"] = currentUsable;
    } else if (formId) {
      next["ID number"] = formId;
    } else if (!isMissingValue(next["ID number"])) {
      // Drop non-digit garbage so load reports ID_EMPTY instead of a fake value.
      next["ID number"] = "";
    }
  }
  const idResult = validateIdNumber(next["ID number"]);
  if (idResult.valid) {
    next["ID number"] = idResult.value;
  }

  // Coerce Gemini/Sheets date serials (2021-10-08 02:00:00) back to MM DD YYYY.
  for (const column of DATE_COLUMNS) {
    const coerced = coerceToMmDdYyyy(next[column]);
    if (/^\d{2}\s+\d{2}\s+\d{4}$/.test(coerced)) {
      next[column] = coerced;
    }
  }

  if (mapping) {
    const formIdForDates =
      next["ID number"] ||
      firstFilled(intakeValues, intakeHeadersFor(mapping, "id_number"));
    const lived = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "years_at_address")
    );
    const livedDate = parseDurationToMmDdYyyy(lived, today, { idNumber: formIdForDates });
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
    } else if (
      isMissingValue(
        next["Year they started working there (calculate from years provided)"]
      ) &&
      !isMissingValue(
        next["Year start living at address (MM DD YYYY format ONLY)"]
      )
    ) {
      // Unparseable Form answers like "months" — mirror residency so Seriti Work Next is not blocked.
      next["Year they started working there (calculate from years provided)"] =
        next["Year start living at address (MM DD YYYY format ONLY)"]!;
    }

    // Re-copy mobile from Form when the sheet cell is empty / Sheets-stripped.
    if (isMissingValue(next["Mobile number"])) {
      const formMobile = firstFilled(intakeValues, [
        ...intakeHeadersFor(mapping, undefined, ["whatsapp_phone", "call_phone"]),
      ]);
      const formMobileResult = transformMobile(formMobile);
      if (formMobileResult.valid) {
        next["Mobile number"] = formMobileResult.value;
        next["Client cellphone number (add again at the end)"] = formMobileResult.value;
      }
    }

    // Prefer Form expense columns; strip R prefixes; empty → standing default 0 later.
    const food = normalizeExpenseAmount(
      firstFilled(intakeValues, intakeHeadersFor(mapping, "food_spend")) || next["Food cost"]
    );
    if (food) next["Food cost"] = food;
    const cellphone = normalizeExpenseAmount(
      firstFilled(intakeValues, intakeHeadersFor(mapping, "cellphone_spend")) ||
        next["Telephone payment"]
    );
    if (cellphone) next["Telephone payment"] = cellphone;
    const accounts = normalizeExpenseAmount(
      firstFilled(intakeValues, intakeHeadersFor(mapping, "accounts_spend")) ||
        next["Transport cost"]
    );
    if (accounts) next["Transport cost"] = accounts;

    // Re-assert Form joins when Gemini/writer left them blank.
    // Ignore placeholder streets like "No" / "N/A" so we still keep the city.
    if (isMissingValue(next["Address line"]) || /^(no|n\/a|na|none|-)\b/i.test(next["Address line"] || "")) {
      const street = firstFilled(
        intakeValues,
        intakeHeadersFor(mapping, "street_address")
      );
      const city = firstFilled(intakeValues, intakeHeadersFor(mapping, "city_town"));
      const usableStreet =
        street && !isMissingValue(street) && !/^(no|n\/a|na|none|-)$/i.test(street.trim())
          ? street
          : "";
      const joined = [usableStreet, city].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (joined) next["Address line"] = joined;
    }
    if (isMissingValue(next["Next of kin name + Surname"])) {
      const nok = joinFilled(
        intakeValues,
        intakeHeadersFor(mapping, undefined, [
          "next_of_kin_first_name",
          "next_of_kin_surname",
        ])
      );
      if (nok) next["Next of kin name + Surname"] = nok;
    }
    // NOK phone: Form sometimes puts an address here. Only keep real mobiles.
    {
      const formNokPhone = firstFilled(
        intakeValues,
        intakeHeadersFor(mapping, "next_of_kin_phone")
      );
      const candidate = isMissingValue(next["Next of kin cellphone number"])
        ? formNokPhone
        : next["Next of kin cellphone number"]!;
      const nokMobile = transformMobile(candidate);
      if (nokMobile.valid) {
        next["Next of kin cellphone number"] = nokMobile.value;
      } else if (!isMissingValue(candidate)) {
        next["Next of kin cellphone number"] = "";
      }
    }
    if (isMissingValue(next["Educational level"])) {
      const edu = firstFilled(
        intakeValues,
        intakeHeadersFor(mapping, "highest_education")
      );
      if (edu && !isMissingValue(edu)) next["Educational level"] = edu;
    }

    // Spouse lives on the automation sheet (loader mapping) even though it is
    // outside the 38-column Gemini contract — copy from Form when present.
    const spouseName = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "spouse_name")
    );
    if (spouseName) next["Spouse Name + Surname"] = spouseName;
    const spousePhone = firstFilled(
      intakeValues,
      intakeHeadersFor(mapping, "spouse_number")
    );
    {
      const candidate = spousePhone || next["Spouse number"] || "";
      if (/^wife|husband|spouse$/i.test(candidate.trim())) {
        next["Spouse number"] = "";
      } else if (!isMissingValue(candidate)) {
        const spouseMobile = transformMobile(candidate);
        next["Spouse number"] = spouseMobile.valid ? spouseMobile.value : "";
      }
    }
    // Blank Form marital: Married when spouse data exists, else standing Single.
    if (isMissingValue(next["Marital status"])) {
      const hasSpouse =
        !isMissingValue(next["Spouse Name + Surname"]) ||
        !isMissingValue(next["Spouse number"]);
      if (hasSpouse) next["Marital status"] = "Married";
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
    // Prefer Gemini level when it maps; else derive from job title; else SKILLED WORKER.
    next["Employee level"] = mapLevel(
      next["Employee level"] || jobTitle || "",
      seriti
    );

    // Employer province falls back to client province — not fabrication of an unknown site.
    if (isMissingValue(next["Employer province (online search)"])) {
      const province =
        next.Province || firstFilled(intakeValues, intakeHeadersFor(mapping, "province"));
      if (province) next["Employer province (online search)"] = province;
    }

    // Self-employed with no public listing: work telephone is the client's own mobile.
    if (
      isSelfEmployed(employment, jobTitle, employerName) &&
      isMissingValue(next["Employer telephone number (online search)"])
    ) {
      const own =
        next["Mobile number"] ||
        next["Client cellphone number (add again at the end)"] ||
        "";
      const ownMobile = transformMobile(own);
      if (ownMobile.valid) {
        next["Employer telephone number (online search)"] = ownMobile.value;
      }
    }

    // When Gemini leaves postal empty, use city/town as a Seriti place-search needle.
    if (isMissingValue(next["Postal code"])) {
      const city = firstFilled(intakeValues, intakeHeadersFor(mapping, "city_town"));
      if (city) next["Postal code"] = city;
    }
  }

  // Pad Sheets-stripped postal codes (83 → 0083). City needles pass through.
  if (!isMissingValue(next["Postal code"])) {
    next["Postal code"] = protectPostal(next["Postal code"]!);
  }
  if (!isMissingValue(next["Employer postal code (online search)"])) {
    next["Employer postal code (online search)"] = protectPostal(
      next["Employer postal code (online search)"]!
    );
  }

  for (const expense of EXPENSE_COLUMNS) {
    const normalized = normalizeExpenseAmount(next[expense]);
    next[expense] = normalized;
  }

  if (mapping) applyStandingDefaults(next, mapping);

  // After standing defaults, expenses must still be numeric for Seriti.
  for (const expense of EXPENSE_COLUMNS) {
    if (isMissingValue(next[expense])) next[expense] = "0";
  }
  if (isMissingValue(next["Educational level"])) {
    next["Educational level"] = "Grade 12";
  }
  next["ID Type"] = "RSA ID";

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
    if (entry && (entry.mode === "copy" || entry.mode === "join" || entry.mode === "writer")) {
      continue;
    }
    values[column] = text;
  }

  return applyDeterministicFixes(values, intakeValues, mapping, today);
}
