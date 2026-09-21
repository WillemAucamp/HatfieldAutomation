/**
 * Print operator readiness: what is configured vs what Willem still must provide.
 * Usage: npm run readiness
 */
import { config as dotenvConfig } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listClientConfigs, loadTokenMapFromEnv } from "../src/product/clients.js";

// Prefer .env over leftover shell exports from prior smoke tests.
dotenvConfig({ path: resolve(".env"), override: true });

type Check = { ok: boolean; label: string; detail?: string };

function isUnsetOrPlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return /YOUR-HOST|PASTE_|EXAMPLE|generate-a-long|fake-webhook|FakeClient|AKfycb\.\.\.|xxx+/i.test(
    v
  );
}

function main(): void {
  const checks: Check[] = [];

  const operator = (process.env.OPERATOR_TOKEN ?? "").trim();
  checks.push({
    ok: !isUnsetOrPlaceholder(operator) && !operator.includes("generate"),
    label: "OPERATOR_TOKEN",
    detail: !isUnsetOrPlaceholder(operator) ? "set" : "run: npm run bootstrap-secrets",
  });

  const webhookId = (process.env.SHEET_WEBHOOK_ID ?? "").trim();
  const webhookUrl = (process.env.SHEET_WEBHOOK_URL ?? "").trim();
  const webhookOk =
    (!isUnsetOrPlaceholder(webhookId) && !webhookId.includes("REDACTED")) ||
    (!isUnsetOrPlaceholder(webhookUrl) && !webhookUrl.includes("REDACTED"));
  checks.push({
    ok: webhookOk,
    label: "SHEET_WEBHOOK_ID (Apps Script)",
    detail: webhookOk
      ? "set"
      : "YOU must deploy apps-script/Code.gs and paste the deployment id",
  });

  const publicUrl = (process.env.PRODUCT_PUBLIC_URL ?? "").trim();
  checks.push({
    ok: !isUnsetOrPlaceholder(publicUrl),
    label: "PRODUCT_PUBLIC_URL",
    detail: !isUnsetOrPlaceholder(publicUrl)
      ? publicUrl
      : "YOU must host the app and set the public URL",
  });

  const clients = listClientConfigs().filter(
    (c) => c.sheetId && !isUnsetOrPlaceholder(c.sheetId)
  );
  checks.push({
    ok: clients.length > 0,
    label: "At least one real client sheet",
    detail:
      clients.length > 0
        ? clients.map((c) => c.id).join(", ")
        : "YOU must run: npm run new-client -- --id … --name … --sheet …",
  });

  const envTokens = loadTokenMapFromEnv();
  for (const c of listClientConfigs()) {
    const secretsPath = resolve(process.env.CLIENTS_DIR ?? "./clients", `${c.id}.secrets.json`);
    let hasToken = envTokens.has(c.id);
    if (!hasToken && existsSync(secretsPath)) {
      try {
        const s = JSON.parse(readFileSync(secretsPath, "utf-8")) as { apiToken?: string };
        hasToken = Boolean(s.apiToken?.trim());
      } catch {
        hasToken = false;
      }
    }
    checks.push({
      ok: hasToken,
      label: `Token for client "${c.id}"`,
      detail: hasToken ? "ok" : `missing secrets / CLIENT_API_TOKENS entry`,
    });
  }

  console.log("\nProduct readiness\n");
  let blocked = 0;
  for (const c of checks) {
    const mark = c.ok ? "OK " : "NEED";
    if (!c.ok) blocked++;
    console.log(`  [${mark}] ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  console.log("");
  if (blocked === 0) {
    console.log("Ready to run: npm run product   (or docker compose up)");
    console.log("Give the client: PRODUCT_PUBLIC_URL + their token (see clients/<id>.handoff.txt)");
  } else {
    console.log(`${blocked} item(s) still need you (hosting / Google / client sheet IDs).`);
    console.log("See docs/YOU_PROVIDE.md");
  }
  process.exit(blocked === 0 ? 0 : 2);
}

main();
