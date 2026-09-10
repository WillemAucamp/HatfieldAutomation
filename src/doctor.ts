import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { postWebhookJson } from "./sheetWriter.js";
import { loadIntakeMapping } from "./intake/mapping.js";
import { enrichWithGemini } from "./intake/gemini.js";
import { flattenRow } from "./intake/headers.js";
import { buildOutputValues } from "./intake/row.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function print(check: Check): void {
  console.log(`${check.ok ? "OK  " : "FAIL"}  ${check.name}: ${check.detail}`);
}

async function probeWebhook(url: string): Promise<{ version?: string; actions?: string[]; error?: string; raw?: unknown }> {
  const get = await fetch(url, { method: "GET", redirect: "follow" });
  const getText = await get.text();
  try {
    const json = JSON.parse(getText) as { version?: string; actions?: string[]; ok?: boolean };
    if (json.version || json.actions) return json;
  } catch {
    // POST handshake below
  }

  try {
    const posted = await postWebhookJson(url, { action: "readSheet", unprocessedOnly: true });
    return { raw: posted };
  } catch (err) {
    return { error: `${get.status} ${getText.slice(0, 180)} | POST ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function doctorMain(): Promise<number> {
  const config = loadConfig();
  const checks: Check[] = [];

  try {
    const mapping = loadIntakeMapping(config.intakeMappingPath);
    checks.push({
      name: "mapping",
      ok: mapping.destination_columns.length === 35,
      detail: `${mapping.destination_columns.length} destination columns, ${mapping.intake_columns.length} intake fields`,
    });
  } catch (err) {
    checks.push({
      name: "mapping",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  checks.push({
    name: "GEMINI_API_KEY",
    ok: Boolean(config.geminiApiKey),
    detail: config.geminiApiKey ? `set (${config.geminiModel})` : "missing — add to .env",
  });

  if (config.geminiApiKey) {
    try {
      const ping = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": config.geminiApiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
          }),
        }
      );
      const body = (await ping.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
      };
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      checks.push({
        name: "Gemini ping",
        ok: ping.ok && /ok/i.test(text),
        detail: ping.ok ? text.trim().slice(0, 80) : body.error?.message ?? `HTTP ${ping.status}`,
      });
    } catch (err) {
      checks.push({
        name: "Gemini ping",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  checks.push({
    name: "SHEET_WEBHOOK_URL",
    ok: Boolean(config.sheetWebhookUrl),
    detail: config.sheetWebhookUrl ? "set" : "missing — paste the Apps Script /exec URL into .env",
  });

  if (config.sheetWebhookUrl) {
    const probe = await probeWebhook(config.sheetWebhookUrl);
    const actions = probe.actions ?? [];
    const versionOk = probe.version === "hatfield-intake-1";
    const readOk =
      versionOk ||
      actions.includes("readSheet") ||
      (probe.raw && typeof probe.raw === "object" && (probe.raw as { ok?: boolean; rows?: unknown }).ok === true);
    const unknownAction =
      probe.raw &&
      typeof probe.raw === "object" &&
      /unknown action/i.test(String((probe.raw as { error?: string }).error ?? ""));

    checks.push({
      name: "Apps Script deploy",
      ok: Boolean(readOk) && !unknownAction,
      detail: versionOk
        ? `hatfield-intake-1 (${actions.join(", ")})`
        : unknownAction
          ? "old deploy — paste apps-script/Code.gs and Deploy → New version"
          : probe.error || JSON.stringify(probe.raw ?? probe).slice(0, 240),
    });
  }

  for (const check of checks) print(check);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.log("\nBlocked on you:");
    for (const check of failed) console.log(`- ${check.name}: ${check.detail}`);
    return 1;
  }
  console.log("\nReady to run: npm run watch");
  return 0;
}

const SAMPLE_INTAKE: Record<string, string> = {
  Timestamp: "2026-09-09 12:00:00",
  "Name and surname": "Thabo Sample",
  "Email address": "thabo.sample@example.com",
  "Call Phone number": "0820000001",
  "Whatsapp Phone number": "0820000001",
  Gender: "Male",
  "Highest education": "Grade 12",
  "Current street address Example: 1058 Steve Biko Road": "1058 Steve Biko Road",
  Province: "Gauteng",
  "City/Town Example: Pretoria/Cape Town/ Kimberley": "Pretoria",
  "How long have you lived here? Example: 3 years/ 2 months": "3 years",
  "Name of Company you work for?": "Hatfield VW",
  "Job title?": "Sales executive",
  "How long have you been working here? Example: 2 Years /6 Months": "2 years",
  "Gross Income per month (Income on your payslip before any payslip deductions)": "25000",
  "Net Income per month? (Income paid into your account by your employer)": "20000",
  "Which bank do you use?": "FNB",
  "Relative or friend Name & surname Example: Vusi Nel": "Vusi Nel",
  "Relative or friend number example: 0856475124": "0820000002",
  "Summary of your expenses, what do you pay on the below Food R2000 Accounts R1000 Other R500":
    "Food R2000 Accounts R1000 Other R500",
  "ID Number": "8001015800084",
  "Thank you for the above info provided, looking forward to getting you the best possible deal Are you okay with us processing your information for this finance application, Do we have your permission to apply on your behalf to see what is the best possible deal?":
    "Yes",
};

export async function enrichSampleMain(): Promise<void> {
  const config = loadConfig();
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
  const mapping = loadIntakeMapping(config.intakeMappingPath);
  console.log("Calling Gemini on fictional sample intake (not written to any sheet)…");
  const fields = await enrichWithGemini(mapping, flattenRow(SAMPLE_INTAKE), {
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
  });
  const values = buildOutputValues(mapping, fields);
  const ordered = mapping.destination_columns.map((column) => [
    column,
    column === "NR" ? "(assigned on append)" : values[column] ?? "",
  ]);
  console.log(JSON.stringify(Object.fromEntries(ordered), null, 2));
}

const isDoctor = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDoctor) {
  const sample = process.argv.includes("--sample");
  const run = sample
    ? enrichSampleMain().then(() => 0)
    : doctorMain();
  run
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
