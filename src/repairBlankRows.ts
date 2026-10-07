/**
 * Repair blank-Status automation rows using live Form data + Seriti mappings,
 * then report which rows are ready to load.
 *
 *   npx tsx src/repairBlankRows.ts
 *   npx tsx src/repairBlankRows.ts --dry-run
 *   npx tsx src/repairBlankRows.ts --load
 */
import { loadColumnMapping, loadConfig } from "./config.js";
import { fetchSheetData } from "./fetchSheetData.js";
import { cell, firstFilled, flattenRow } from "./intake/headers.js";
import {
  enrichEmployerWithSearch,
  enrichWithGemini,
  needsEmployerPhone,
  normalizeEmployerPhone,
} from "./intake/gemini.js";
import { loadIntakeMapping } from "./intake/mapping.js";
import { buildOutputValues, normalizeEmail } from "./intake/row.js";
import {
  isSelfEmployed,
  loadSeritiOptions,
  mapIndustry,
  mapLevel,
  mapOccupation,
} from "./intake/seritiOptions.js";
import { readSheetRows } from "./intake/sheets.js";
import { postWebhookJson } from "./sheetWriter.js";
import { isMissingValue } from "./transforms.js";

const PATCH_COLUMNS = [
  "Address line",
  "Postal code",
  "Next of kin name + Surname",
  "Next of kin cellphone number",
  "Next of kin relationship",
  "Transport cost",
  "Telephone payment",
  "Food cost",
  "Industry (AI based on employer)",
  "Occupation",
  "Employee level",
  "Email",
  "Educational level",
  "Marital status",
  "Employer telephone number (online search)",
  "Employer street address (online search)",
  "Employer postal code (online search)",
  "Employer province (online search)",
] as const;

const EMPLOYER_PHONE_COLUMN = "Employer telephone number (online search)";

function norm(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function matchIntake(
  auto: Record<string, string>,
  intakeRows: Array<{ rowIndex: number; values: Record<string, string> }>,
  mapping: ReturnType<typeof loadIntakeMapping>
): Record<string, string> | null {
  const email = norm(auto.Email || "");
  const id = String(auto["ID number"] || "").replace(/\D/g, "");
  const name = norm(auto["Full name"] || auto["First names + surname"] || "");

  for (const row of intakeRows) {
    const iEmail = norm(cell(row.values, mapping.intake_headers.email));
    const iId = cell(row.values, mapping.intake_headers.id_number).replace(/\D/g, "");
    const iName = norm(cell(row.values, mapping.intake_headers.name_and_surname));
    if (email && iEmail && email === iEmail) return row.values;
    if (id && iId && id === iId) return row.values;
    if (name && iName && name === iName) return row.values;
  }
  return null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const doLoad = process.argv.includes("--load");
  const config = loadConfig();
  const mapping = loadIntakeMapping(config.intakeMappingPath);
  const seriti = loadSeritiOptions();

  if (!config.sheetWebhookUrl) throw new Error("SHEET_WEBHOOK_URL is required");

  console.log("Reading automation sheet (blank Status)…");
  const autoRows = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.sheetId,
    unprocessedOnly: true,
    statusColumn: "Status",
    processableStatuses: [""],
  });
  console.log(`Blank-Status rows: ${autoRows.length}`);

  console.log("Reading Form intake sheet…");
  const intakeRows = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    sheetName: "Form Responses 1",
    unprocessedOnly: false,
  });
  console.log(`Intake rows: ${intakeRows.length}`);

  let patched = 0;
  let reenriched = 0;
  let skipped = 0;
  const updates: Array<{ row: number; column: string; value: string }> = [];

  for (const auto of autoRows) {
    const label = `row ${auto.rowIndex}`;
    const intake = matchIntake(auto.values, intakeRows, mapping);
    let next = { ...auto.values };

    // Always apply cheap standing defaults / Seriti remaps on the existing cells.
    if (isMissingValue(next["Next of kin relationship"])) {
      next["Next of kin relationship"] =
        mapping.standing_defaults?.["Next of kin relationship"] || "Friend";
    }
    if (isMissingValue(next["Transport cost"])) {
      next["Transport cost"] = mapping.standing_defaults?.["Transport cost"] || "0";
    }
    if (next.Email) next.Email = normalizeEmail(next.Email);

    const jobTitle =
      (intake
        ? firstFilled(intake, [mapping.intake_headers.job_title || "Job title?"])
        : "") || next.Occupation || "";
    const employment = intake
      ? firstFilled(intake, [mapping.intake_headers.employment || "Employment"])
      : "";
    const employerName =
      (intake
        ? firstFilled(intake, [mapping.intake_headers.employer_name || ""])
        : "") || next["Employer name"] || "";

    if (isSelfEmployed(employment, jobTitle, employerName)) {
      next["Industry (AI based on employer)"] = seriti.self_employed_industry;
    } else {
      next["Industry (AI based on employer)"] = mapIndustry(
        next["Industry (AI based on employer)"] || "",
        seriti
      );
    }
    // Prefer mapping the existing sheet Occupation when it already hits a Seriti option.
    const sheetOcc = next.Occupation || "";
    const mappedSheetOcc = mapOccupation(sheetOcc, seriti);
    if (sheetOcc && mappedSheetOcc !== seriti.occupation_fallback) {
      next.Occupation = mappedSheetOcc;
    } else {
      next.Occupation = mapOccupation(jobTitle || sheetOcc, seriti);
    }
    next["Employee level"] = mapLevel(next["Employee level"] || "", seriti);

    if (isMissingValue(next["Employer province (online search)"])) {
      next["Employer province (online search)"] = next.Province || "";
    }

    const needsFormCopy =
      isMissingValue(next["Address line"]) ||
      isMissingValue(next["Next of kin name + Surname"]) ||
      isMissingValue(next["Educational level"]) ||
      isMissingValue(next["Telephone payment"]) ||
      isMissingValue(next["Food cost"]) ||
      isMissingValue(next["Marital status"]);

    if (needsFormCopy && intake) {
      // Deterministic Form copy/join first (address, NOK, expenses, dates).
      const copied = buildOutputValues(mapping, {}, intake);
      for (const col of PATCH_COLUMNS) {
        if (!isMissingValue(copied[col])) next[col] = copied[col]!;
      }

      const needsGemini =
        isMissingValue(next["Postal code"]) ||
        isMissingValue(next["Industry (AI based on employer)"]) ||
        isMissingValue(next["Employee level"]) ||
        isMissingValue(next["Year start living at address (MM DD YYYY format ONLY)"]) ||
        isMissingValue(next["Year they started working there (calculate from years provided)"]);

      if (needsGemini && !dryRun) {
        console.log(`Gemini infer for ${label}…`);
        try {
          const llm = await enrichWithGemini(mapping, flattenRow(intake), {
            apiKey: config.geminiApiKey,
            model: config.geminiModel,
          });
          const rebuilt = buildOutputValues(mapping, llm, intake);
          for (const col of PATCH_COLUMNS) {
            if (!isMissingValue(rebuilt[col])) next[col] = rebuilt[col]!;
          }
          reenriched += 1;
        } catch (err) {
          console.warn(
            `Gemini failed for ${label}; keeping Form copy (${
              err instanceof Error ? err.message : String(err)
            })`
          );
        }
      } else {
        console.log(`Form-copy repaired ${label}${dryRun ? " (dry-run)" : ""}`);
        reenriched += 1;
      }
    } else if (needsFormCopy && !intake) {
      console.warn(`No Form match for ${label} — cannot refill address/NOK`);
      skipped += 1;
    }

    // Brute-force employer telephone via google_search even when other cells look fine.
    if (needsEmployerPhone(next) && intake && !dryRun) {
      console.log(`Employer google_search for ${label} (${employerName || "no name"})…`);
      try {
        const found = await enrichEmployerWithSearch(
          mapping,
          flattenRow(intake),
          {
            apiKey: config.geminiApiKey,
            model: config.geminiModel,
            employerSearchAttempts: 3,
          },
          next
        );
        for (const col of [
          EMPLOYER_PHONE_COLUMN,
          "Employer street address (online search)",
          "Employer postal code (online search)",
          "Employer province (online search)",
        ] as const) {
          const value = found[col] ?? "";
          if (col === EMPLOYER_PHONE_COLUMN) {
            const phone = normalizeEmployerPhone(value);
            if (phone) next[col] = phone;
          } else if (!isMissingValue(value)) {
            next[col] = value;
          }
        }
        reenriched += 1;
      } catch (err) {
        console.warn(
          `Employer search failed for ${label}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } else if (needsEmployerPhone(next) && !intake) {
      console.warn(`No Form match for ${label} — cannot search employer phone`);
    }

    for (const col of PATCH_COLUMNS) {
      const before = String(auto.values[col] ?? "").trim();
      const after = String(next[col] ?? "").trim();
      if (after && after !== before) {
        updates.push({ row: auto.rowIndex, column: col, value: after });
      }
    }
    patched += 1;
  }

  console.log(
    `Prepared ${updates.length} cell update(s) across ${patched} row(s); re-enriched=${reenriched}; no-form-match=${skipped}`
  );

  if (dryRun) {
    console.log("DRY RUN — first 40 updates:");
    for (const u of updates.slice(0, 40)) {
      console.log(`  row ${u.row} ${u.column}=${JSON.stringify(u.value)}`);
    }
    return;
  }

  // Batch updates to keep Apps Script payloads manageable.
  const chunkSize = 40;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const parsed = await postWebhookJson(config.sheetWebhookUrl, {
      action: "updateSheet",
      spreadsheetId: config.sheetId,
      updates: chunk,
    });
    if (parsed.ok === false) {
      throw new Error(String(parsed.error || "updateSheet failed"));
    }
    console.log(`Wrote updates ${i + 1}-${i + chunk.length}`);
  }

  console.log("Re-previewing blank-Status rows…");
  const columnMapping = loadColumnMapping(config.mappingPath);
  const applicants = await fetchSheetData({
    csvUrl: config.sheetCsvUrl,
    mapping: columnMapping,
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.sheetId,
  });
  const ready = applicants.filter((a) => a.errors.length === 0);
  const blocked = applicants.filter((a) => a.errors.length > 0);
  console.log(`${applicants.length} blank-Status: ${ready.length} ready, ${blocked.length} blocked`);
  for (const a of ready) {
    console.log(
      `  READY row ${a.rowIndex} ${a.firstName} ${a.surname} | ${a.industry} / ${a.occupation} / ${a.employeeLevel}`
    );
  }
  for (const a of blocked) {
    console.log(
      `  BLOCKED row ${a.rowIndex} ${a.firstName} ${a.surname}: ${a.errors.map((e) => e.code).join(", ")}`
    );
  }

  if (doLoad && ready.length > 0) {
    const rows = ready.map((a) => a.rowIndex).join(",");
    console.log(`Starting Seriti load for rows: ${rows}`);
    process.env.ROW_FILTER = rows;
    process.env.HEADLESS = "true";
    process.env.AUTO_LOAD = "true";
    const { runBatchMain } = await import("./runBatch.js");
    await runBatchMain();
  } else if (doLoad) {
    console.log("No ready rows to load.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
