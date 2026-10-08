/**
 * Repair blank-Status automation rows using live Form data + Seriti mappings,
 * then report which rows are ready to load.
 *
 * Always rebuilds matched rows through buildOutputValues so Seriti menus,
 * dates, address/NOK joins, expenses, and ID Type stick permanently.
 *
 *   npx tsx src/repairBlankRows.ts
 *   npx tsx src/repairBlankRows.ts --dry-run
 *   npx tsx src/repairBlankRows.ts --load
 *   npx tsx src/repairBlankRows.ts --rows 320,321,322
 */
import { loadColumnMapping, loadConfig } from "./config.js";
import { fetchSheetData } from "./fetchSheetData.js";
import { cell, flattenRow } from "./intake/headers.js";
import {
  enrichEmployerWithSearch,
  needsEmployerPhone,
  normalizeEmployerPhone,
} from "./intake/gemini.js";
import { loadIntakeMapping } from "./intake/mapping.js";
import { applyDeterministicFixes, buildOutputValues } from "./intake/row.js";
import { readSheetRows } from "./intake/sheets.js";
import { postWebhookJson } from "./sheetWriter.js";
import { isMissingValue } from "./transforms.js";

const PATCH_COLUMNS = [
  "Full name",
  "First names + surname",
  "Title",
  "ID Type",
  "ID number",
  "Educational level",
  "Mobile number",
  "Address line",
  "Postal code",
  "Province",
  "Year start living at address (MM DD YYYY format ONLY)",
  "Year they started working there (calculate from years provided)",
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
  "Marital status",
  "Spouse Name + Surname",
  "Spouse number",
  "Max price range",
  "Employer name",
  "Employer telephone number (online search)",
  "Employer street address (online search)",
  "Employer postal code (online search)",
  "Employer province (online search)",
  "Account type (AI—most likely option based on bank)",
  "Account holder name and surname (same as client)",
  "Client cellphone number (add again at the end)",
] as const;

const EMPLOYER_PHONE_COLUMN = "Employer telephone number (online search)";

function norm(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseRowFilter(argv: string[]): number[] {
  const idx = argv.indexOf("--rows");
  if (idx === -1 || !argv[idx + 1]) return [];
  return argv[idx + 1]!
    .split(",")
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 2);
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

async function readWithRetry<T>(
  label: string,
  fn: () => Promise<T[]>,
  attempts = 5
): Promise<T[]> {
  for (let i = 1; i <= attempts; i++) {
    const rows = await fn();
    console.log(`${label} attempt ${i}: ${rows.length}`);
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
  return [];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const doLoad = process.argv.includes("--load");
  const onlyRows = parseRowFilter(process.argv);
  const config = loadConfig();
  const mapping = loadIntakeMapping(config.intakeMappingPath);

  if (!config.sheetWebhookUrl) throw new Error("SHEET_WEBHOOK_URL is required");

  console.log("Reading automation sheet (blank Status)…");
  let autoRows = await readWithRetry("auto", () =>
    readSheetRows({
      webhookUrl: config.sheetWebhookUrl!,
      spreadsheetId: config.sheetId,
      unprocessedOnly: true,
      statusColumn: "Status",
      processableStatuses: [""],
    })
  );
  if (onlyRows.length) {
    autoRows = autoRows.filter((r) => onlyRows.includes(r.rowIndex));
  }
  console.log(`Blank-Status rows to repair: ${autoRows.length}`);

  console.log("Reading Form intake sheet…");
  const intakeRows = await readWithRetry("intake", () =>
    readSheetRows({
      webhookUrl: config.sheetWebhookUrl!,
      spreadsheetId: config.intakeSpreadsheetId,
      sheetName: "Form Responses 1",
      unprocessedOnly: false,
    })
  );

  let patched = 0;
  let reenriched = 0;
  let skipped = 0;
  const updates: Array<{ row: number; column: string; value: string }> = [];

  for (const auto of autoRows) {
    const label = `row ${auto.rowIndex}`;
    const intake = matchIntake(auto.values, intakeRows, mapping);
    let next = { ...auto.values };

    if (intake) {
      // Seed LLM fields from whatever is already on the sheet so employer search
      // and industry inference can reuse prior work, then rebuild deterministically.
      const seed: Record<string, string> = {};
      for (const col of [
        "Postal code",
        "Industry (AI based on employer)",
        "Employee level",
        "Employer telephone number (online search)",
        "Employer street address (online search)",
        "Employer postal code (online search)",
        "Employer province (online search)",
        "Year start living at address (MM DD YYYY format ONLY)",
        "Year they started working there (calculate from years provided)",
      ]) {
        if (!isMissingValue(next[col] || "")) seed[col] = next[col]!;
      }
      const rebuilt = buildOutputValues(mapping, seed, intake);
      for (const col of PATCH_COLUMNS) {
        if (col in rebuilt && rebuilt[col] !== undefined) {
          // Keep a usable employer phone already on the sheet unless rebuilt has one.
          if (
            col === EMPLOYER_PHONE_COLUMN &&
            isMissingValue(rebuilt[col] || "") &&
            !isMissingValue(next[col] || "")
          ) {
            continue;
          }
          next[col] = rebuilt[col]!;
        }
      }
      console.log(`Form-rebuild ${label}`);
      reenriched += 1;
    } else {
      // No Form match — still remap Seriti menus / defaults on sheet values alone.
      next = applyDeterministicFixes(next, {}, mapping);
      console.warn(`No Form match for ${label} — applied sheet-only Seriti remaps`);
      skipped += 1;
    }

    const employerName = String(next["Employer name"] || "").trim();
    if (needsEmployerPhone(next) && employerName && !dryRun) {
      const searchText = intake
        ? flattenRow(intake)
        : [
            `Name of Company you work for?: ${employerName}`,
            `Job title?: ${next.Occupation || ""}`,
            `Province: ${next.Province || ""}`,
            `Address: ${next["Address line"] || ""}`,
          ].join("\n");
      console.log(
        `Employer google_search for ${label} (${employerName}) source=${intake ? "form" : "sheet"}…`
      );
      try {
        const found = await enrichEmployerWithSearch(
          mapping,
          searchText,
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
      } catch (err) {
        console.warn(
          `Employer search failed for ${label}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } else if (needsEmployerPhone(next) && !employerName) {
      console.warn(`No employer name for ${label} — cannot search employer phone`);
    }

    // Final pass so Seriti exact strings / defaults always win.
    next = applyDeterministicFixes(next, intake || {}, mapping);

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
    `Prepared ${updates.length} cell update(s) across ${patched} row(s); rebuilt=${reenriched}; no-form-match=${skipped}`
  );

  if (dryRun) {
    console.log("DRY RUN — updates:");
    for (const u of updates) {
      console.log(`  row ${u.row} ${u.column}=${JSON.stringify(u.value)}`);
    }
    return;
  }

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
    ...(onlyRows.length ? { rowFilter: onlyRows } : {}),
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
