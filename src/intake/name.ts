import { firstFilled } from "./headers.js";
import type { IntakeMapping } from "./mapping.js";

/** Join given names + surname without duplicating a surname already in the first field. */
export function joinPersonName(first: string, surname: string): string {
  const given = String(first ?? "").replace(/\s+/g, " ").trim();
  const family = String(surname ?? "").replace(/\s+/g, " ").trim();
  if (!family) return given;
  if (!given) return family;
  if (given.toLowerCase() === family.toLowerCase()) return given;
  if (given.toLowerCase().endsWith(` ${family.toLowerCase()}`)) return given;
  return `${given} ${family}`;
}

export function intakeFirstNameHeaders(mapping: IntakeMapping): string[] {
  return [
    mapping.intake_headers.first_name,
    mapping.intake_headers.name_and_surname,
    "First Name",
    "Name and surname",
  ].filter(Boolean);
}

export function intakeSurnameHeaders(mapping: IntakeMapping): string[] {
  return [mapping.intake_headers.surname, "Surname"].filter(Boolean);
}

export function formApplicantName(
  row: Record<string, string>,
  mapping: IntakeMapping
): string {
  return joinPersonName(
    firstFilled(row, intakeFirstNameHeaders(mapping)),
    firstFilled(row, intakeSurnameHeaders(mapping))
  );
}
