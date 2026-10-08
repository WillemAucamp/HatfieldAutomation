import { cell } from "./headers.js";
import type { IntakeMapping } from "./mapping.js";
import { usableIdDigits } from "../transforms.js";

function norm(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface IntakeMatchCandidate {
  rowIndex: number;
  values: Record<string, string>;
  score: number;
}

/**
 * Pick the best Form row for an automation sheet applicant.
 * Prefer Enrichment Status that points at this automation row, then a usable
 * RSA ID, then email/name. First-email-wins used to match older Form rows
 * where consent "Yes" leaked into the ID Number column and wiped good IDs.
 */
export function scoreIntakeMatch(
  auto: Record<string, string>,
  intake: { rowIndex: number; values: Record<string, string> },
  mapping: IntakeMapping,
  autoRowIndex?: number
): number {
  const email = norm(auto.Email || "");
  const id = usableIdDigits(auto["ID number"] || "");
  const name = norm(auto["Full name"] || auto["First names + surname"] || "");

  const iEmail = norm(cell(intake.values, mapping.intake_headers.email));
  const iIdRaw = cell(intake.values, mapping.intake_headers.id_number);
  const iId = usableIdDigits(iIdRaw);
  const iName = norm(cell(intake.values, mapping.intake_headers.name_and_surname));

  let score = 0;
  if (email && iEmail && email === iEmail) score += 10;
  if (id && iId && id === iId) score += 20;
  if (name && iName && name === iName) score += 5;
  if (score === 0) return 0;

  if (autoRowIndex && autoRowIndex >= 2) {
    const enrich = String(intake.values["Enrichment Status"] ?? "");
    if (new RegExp(`enriched row ${autoRowIndex}\\b`, "i").test(enrich)) {
      score += 50;
    }
  }

  // Prefer Form rows that actually carry a digit ID over "Yes"/blank leaks.
  if (iId) score += 15;
  else if (iIdRaw && !/\d/.test(iIdRaw)) score -= 20;

  // Prefer newer Form rows when scores otherwise tie.
  score += Math.min(intake.rowIndex, 10_000) / 100_000;
  return score;
}

export function matchIntakeRow(
  auto: Record<string, string>,
  intakeRows: Array<{ rowIndex: number; values: Record<string, string> }>,
  mapping: IntakeMapping,
  autoRowIndex?: number
): IntakeMatchCandidate | null {
  let best: IntakeMatchCandidate | null = null;
  for (const row of intakeRows) {
    const score = scoreIntakeMatch(auto, row, mapping, autoRowIndex);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { rowIndex: row.rowIndex, values: row.values, score };
    }
  }
  return best;
}
