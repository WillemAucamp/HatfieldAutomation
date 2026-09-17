/**
 * Per-client product configuration.
 *
 * Client-facing secrets (API tokens) live in env: CLIENT_API_TOKENS=id:token,id2:token2
 * or in gitignored clients/<id>.secrets.json. Sheet IDs are per client; webhook /
 * Seriti secrets stay on operator infra.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface ClientConfig {
  id: string;
  displayName: string;
  /** When false, client UI can view status but cannot start jobs. */
  enabled: boolean;
  /** Applicant / App Automation spreadsheet id (client-owned). */
  sheetId: string;
  sheetGid?: string;
  /** Optional loaded-clients / money spreadsheet id (client-owned). */
  loadedSheetId?: string;
  loadedNameColumn?: string;
  loadedNumberColumn?: string;
  /** Relative path to mapping JSON; defaults to repo mapping.json. */
  mappingPath?: string;
  /** Override finance URL only if needed later; default is VW Melrose. */
  financeUrl?: string;
  /** Optional per-client Apps Script deployment id (else shared SHEET_WEBHOOK_ID). */
  webhookDeploymentId?: string;
  notes?: string;
}

export interface ClientPublicView {
  id: string;
  displayName: string;
  enabled: boolean;
  sheetId: string;
  hasLoadedSheet: boolean;
  financeUrl: string;
}

const DEFAULT_FINANCE_URL = "https://vwmelrose.hatfieldgroup.co.za/finance";

export function clientsDir(): string {
  return resolve(process.env.CLIENTS_DIR ?? "./clients");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Parse CLIENT_API_TOKENS=acme:tok1,other:tok2 */
export function loadTokenMapFromEnv(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.CLIENT_API_TOKENS ?? "";
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const id = trimmed.slice(0, idx).trim();
    const token = trimmed.slice(idx + 1).trim();
    if (id && token) map.set(id, token);
  }
  return map;
}

function loadSecretsFile(clientId: string): { apiToken?: string } {
  const path = join(clientsDir(), `${clientId}.secrets.json`);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as { apiToken?: string };
  } catch {
    return {};
  }
}

export function listClientConfigs(): ClientConfig[] {
  const dir = clientsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_") && !f.endsWith(".secrets.json")
  );
  const clients: ClientConfig[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf-8")) as ClientConfig;
      const id = raw.id || basename(file, ".json");
      if (!raw.sheetId) {
        console.warn(`[clients] Skipping ${file}: sheetId is required`);
        continue;
      }
      clients.push({
        ...raw,
        id,
        displayName: raw.displayName || id,
        enabled: raw.enabled !== false,
        sheetGid: raw.sheetGid ?? "0",
        financeUrl: raw.financeUrl || DEFAULT_FINANCE_URL,
        mappingPath: raw.mappingPath || "./mapping.json",
        loadedNameColumn: raw.loadedNameColumn || "Name",
        loadedNumberColumn: raw.loadedNumberColumn || "Number",
      });
    } catch (err) {
      console.warn(`[clients] Failed to load ${file}:`, err);
    }
  }
  return clients.sort((a, b) => a.id.localeCompare(b.id));
}

export function getClient(clientId: string): ClientConfig | undefined {
  return listClientConfigs().find((c) => c.id === clientId);
}

export function toPublicView(client: ClientConfig): ClientPublicView {
  return {
    id: client.id,
    displayName: client.displayName,
    enabled: client.enabled,
    sheetId: client.sheetId,
    hasLoadedSheet: Boolean(client.loadedSheetId),
    financeUrl: client.financeUrl || DEFAULT_FINANCE_URL,
  };
}

export interface AuthResult {
  role: "client" | "operator";
  clientId?: string;
  client?: ClientConfig;
}

export function authenticateBearer(token: string | undefined): AuthResult | null {
  if (!token?.trim()) return null;
  const clean = token.trim();

  const operatorToken = (process.env.OPERATOR_TOKEN ?? "").trim();
  if (operatorToken && clean === operatorToken) {
    return { role: "operator" };
  }

  const envTokens = loadTokenMapFromEnv();
  for (const client of listClientConfigs()) {
    const fromEnv = envTokens.get(client.id);
    const fromFile = loadSecretsFile(client.id).apiToken;
    const expected = (fromEnv || fromFile || "").trim();
    if (!expected) continue;
    if (expected.startsWith("sha256:")) {
      const hash = expected.slice("sha256:".length);
      if (safeEqualHex(hashToken(clean), hash)) {
        return { role: "client", clientId: client.id, client };
      }
    } else if (clean === expected) {
      return { role: "client", clientId: client.id, client };
    }
  }
  return null;
}

/** Env bag injected into a child job for this client. */
export function clientJobEnv(client: ClientConfig): Record<string, string> {
  const gid = client.sheetGid ?? "0";
  const sheetCsvUrl = `https://docs.google.com/spreadsheets/d/${client.sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const env: Record<string, string> = {
    SHEET_ID: client.sheetId,
    SHEET_CSV_URL: sheetCsvUrl,
    MAPPING_PATH: resolve(client.mappingPath || "./mapping.json"),
    FINANCE_URL: client.financeUrl || DEFAULT_FINANCE_URL,
    HEADLESS: "true",
    KEEP_LAST_OPEN: "false",
    LOADED_NAME_COLUMN: client.loadedNameColumn || "Name",
    LOADED_NUMBER_COLUMN: client.loadedNumberColumn || "Number",
  };
  if (client.loadedSheetId) {
    env.LOADED_SHEET_ID = client.loadedSheetId;
  } else {
    env.LOADED_SHEET_ID = "";
  }
  if (client.webhookDeploymentId) {
    env.SHEET_WEBHOOK_ID = client.webhookDeploymentId;
  }
  return env;
}

export function generateApiToken(): string {
  return randomBytes(24).toString("base64url");
}

export function requiredColumnsDoc(): string[] {
  return [
    "Email",
    "First names + surname (or First name + Surname)",
    "ID number",
    "Mobile number",
    "Address line",
    "Postal code",
    "Province",
    "Year start living at address (MM DD YYYY format ONLY)",
    "Next of kin name + Surname",
    "Next of kin cellphone number",
    "Employer name",
    "Employer telephone number (online search)",
    "Employer street address (online search)",
    "Employer postal code (online search)",
    "Employer province (online search)",
    "Year they started working there (calculate from years provided)",
    "Gross monthly salary",
    "Nett salary",
    "Telephone payment",
    "Transport cost",
    "Food cost",
    "Account holder name and surname (same as client)",
    "Bank name",
    "Account type (AI—most likely option based on bank)",
    "Status (write-back)",
    "Timing (write-back)",
  ];
}
