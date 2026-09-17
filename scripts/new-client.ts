/**
 * Scaffold a new client config + API token and print the handoff pack.
 *
 * Usage:
 *   npm run new-client -- --id acme --name "Acme Motors" --sheet SHEET_ID
 *   npm run new-client -- --id acme --name "Acme Motors" --sheet SHEET_ID --loaded LOADED_ID
 *   npm run new-client -- --id acme --name "Acme Motors" --sheet SHEET_ID --print-email
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateApiToken } from "../src/product/clients.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.error(`Usage:
  npm run new-client -- --id <slug> --name "Display Name" --sheet <SHEET_ID> [--loaded <LOADED_SHEET_ID>] [--print-email]

Example:
  npm run new-client -- --id melrose --name "VW Melrose Partner" --sheet 1abc...xyz --loaded 1def...uvw --print-email`);
  process.exit(1);
}

function main(): void {
  const id = (arg("id") ?? "").trim().toLowerCase();
  const displayName = (arg("name") ?? "").trim();
  const sheetId = (arg("sheet") ?? "").trim();
  const loadedSheetId = (arg("loaded") ?? "").trim();
  if (!id || !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    console.error("--id must be a slug like acme or vw-partner");
    usage();
  }
  if (!displayName) {
    console.error("--name is required");
    usage();
  }
  if (!sheetId || /PASTE_|EXAMPLE|FakeClient|YOUR_/i.test(sheetId)) {
    console.error("--sheet must be the client's real Google Spreadsheet ID");
    usage();
  }

  const clientsDir = resolve(process.env.CLIENTS_DIR ?? "./clients");
  mkdirSync(clientsDir, { recursive: true });
  const configPath = resolve(clientsDir, `${id}.json`);
  const secretsPath = resolve(clientsDir, `${id}.secrets.json`);

  if (existsSync(configPath) && !flag("force")) {
    console.error(`Refusing to overwrite ${configPath} (pass --force to replace)`);
    process.exit(1);
  }

  const token = generateApiToken();
  const config = {
    id,
    displayName,
    enabled: true,
    sheetId,
    sheetGid: "0",
    ...(loadedSheetId ? { loadedSheetId } : {}),
    loadedNameColumn: "Name",
    loadedNumberColumn: "Number",
    mappingPath: "./mapping.json",
    financeUrl: "https://vwmelrose.hatfieldgroup.co.za/finance",
    notes: `Created ${new Date().toISOString()}`,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  writeFileSync(secretsPath, JSON.stringify({ apiToken: token }, null, 2) + "\n");

  const publicUrl = (process.env.PRODUCT_PUBLIC_URL ?? "https://YOUR-HOST:8787").replace(/\/$/, "");

  console.log("\n=== Client registered ===");
  console.log(`Config:  ${configPath}`);
  console.log(`Secrets: ${secretsPath}  (gitignored)`);
  console.log(`Token:   ${token}`);
  console.log("\nAlso add to .env if you prefer env tokens:");
  console.log(`  CLIENT_API_TOKENS=${id}:${token}`);
  console.log("\nNext:");
  console.log("  1. Deploy Apps Script on their sheet (docs/APPS_SCRIPT_CHECKLIST.md)");
  console.log("  2. npm run validate-sheet -- --client " + id);
  console.log("  3. Host the product (docker compose up) and set PRODUCT_PUBLIC_URL");
  console.log("  4. Send them the handoff below\n");

  if (flag("print-email") || true) {
    const email = buildEmail({
      displayName,
      publicUrl,
      token,
    });
    const out = resolve(clientsDir, `${id}.handoff.txt`);
    writeFileSync(out, email);
    console.log("--- Copy to client ---");
    console.log(email);
    console.log(`(also saved to ${out})`);
  }
}

function buildEmail(opts: {
  displayName: string;
  publicUrl: string;
  token: string;
}): string {
  return `Subject: Your finance load runner is ready

Hi,

Your load runner is ready. You do not need GitHub or a terminal.

1. Keep using your Google Sheet. Leave Status blank on rows to load.
2. Open: ${opts.publicUrl}
3. Paste this access token:

${opts.token}

4. Click Continue, then Run open rows.
5. Refresh the sheet — Status will show ZAHTVW… on success, or error … if something needs fixing.

To retry one failed row, enter the sheet row number and click Retry row.

Keep the token private. Reply if you need it rotated.

— ${opts.displayName} load runner
`;
}

main();
