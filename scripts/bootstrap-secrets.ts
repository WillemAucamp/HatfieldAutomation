/**
 * Generate OPERATOR_TOKEN (and optionally a first client token stub) into .env
 * without overwriting existing values.
 *
 * Usage: npm run bootstrap-secrets
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateApiToken } from "../src/product/clients.js";

const envPath = resolve(".env");
const examplePath = resolve(".env.example");

function upsertEnv(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    const current = content.match(re)?.[0] ?? "";
    const existing = current.slice(key.length + 1).trim();
    if (existing && !existing.includes("generate") && existing !== "") {
      console.log(`Keeping existing ${key}`);
      return content;
    }
    return content.replace(re, line);
  }
  return content.trimEnd() + `\n${line}\n`;
}

function main(): void {
  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  } else if (existsSync(examplePath)) {
    content = readFileSync(examplePath, "utf-8");
    console.log("Created .env from .env.example");
  } else {
    content = "";
  }

  const operator = generateApiToken();
  content = upsertEnv(content, "OPERATOR_TOKEN", operator);
  content = upsertEnv(content, "HEADLESS", "true");
  content = upsertEnv(content, "PRODUCT_PORT", "8787");
  if (!/^PRODUCT_PUBLIC_URL=/m.test(content)) {
    content = upsertEnv(content, "PRODUCT_PUBLIC_URL", "https://YOUR-HOST");
  }

  writeFileSync(envPath, content.endsWith("\n") ? content : content + "\n");
  console.log(`Wrote ${envPath}`);
  console.log(`OPERATOR_TOKEN=${operator}`);
  console.log("\nStill required from you:");
  console.log("  SHEET_WEBHOOK_ID=…   (Apps Script deployment id)");
  console.log("  PRODUCT_PUBLIC_URL=… (public URL after you host)");
  console.log("  npm run new-client -- --id … --name … --sheet …");
}

main();
