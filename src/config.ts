import { config as dotenvConfig } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig, ColumnMapping } from "./types.js";
import { DEFAULT_SHEET_CSV_URL, DEFAULT_SHEET_ID, extractSheetId } from "./sheetCsv.js";

dotenvConfig();

interface FileConfig {
  sheetCsvUrl?: string;
  mappingPath?: string;
  financeUrl?: string;
  sheetId?: string;
  sheetWebhookUrl?: string;
  googleServiceAccountFile?: string;
  loadedSheetId?: string;
  loadedSheetWebhookUrl?: string;
  loadedNameColumn?: string;
  loadedNumberColumn?: string;
}

function loadFileConfig(): FileConfig {
  const path = resolve(process.env.CONFIG_PATH ?? "./config.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as FileConfig;
  } catch {
    return {};
  }
}

/**
 * Cloud / paste secrets sometimes arrive as `NAME=value` or with surrounding quotes.
 * For SHEET_WEBHOOK_URL we also recover an embedded Apps Script /exec URL.
 */
export function normalizeEnvValue(raw: string | undefined, envName?: string): string {
  if (raw == null) return "";
  let value = String(raw).trim();
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (envName) {
    const prefix = `${envName}=`;
    if (value.toUpperCase().startsWith(prefix.toUpperCase())) {
      value = value.slice(prefix.length).trim();
    }
  }
  if (envName === "SHEET_WEBHOOK_URL" || envName === "LOADED_SHEET_WEBHOOK_URL") {
    const match = value.match(
      /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/
    );
    if (match) return match[0];
  }
  return value;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

/** Sheet data rows start at 2. Ignore 0 (Apps Script 302) and 1 (header). */
export function parseRowFilter(value: string | undefined): number[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 2);
}

function cliFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Build Apps Script webhook URL. Prefer deployment id over full URL env secrets. */
function resolveWebhookUrl(
  deploymentId: string | undefined,
  fullUrl: string | undefined,
  fileUrl: string | undefined
): string {
  const id = (deploymentId ?? "").trim();
  if (id && !id.includes("REDACTED")) {
    return `https://script.google.com/macros/s/${id}/exec`;
  }
  for (const candidate of [fullUrl, fileUrl]) {
    const url = (candidate ?? "").trim();
    if (
      url &&
      !url.includes("[REDACTED]") &&
      !url.includes("REDACTED") &&
      /^https?:\/\//i.test(url)
    ) {
      return url;
    }
  }
  return "";
}

export function loadConfig(): AppConfig {
  const fileConfig = loadFileConfig();
  const dryRun = cliFlag("dry-run") || parseBool(process.env.DRY_RUN, false);
  const strictMode =
    cliFlag("strict") ||
    (!cliFlag("no-strict") && parseBool(process.env.STRICT_MODE, false));

  return {
    sheetCsvUrl:
      process.env.SHEET_CSV_URL ||
      fileConfig.sheetCsvUrl ||
      DEFAULT_SHEET_CSV_URL,
    mappingPath: process.env.MAPPING_PATH ?? fileConfig.mappingPath ?? "./mapping.json",
    dryRun,
    strictMode,
    headless: parseBool(process.env.HEADLESS, false),
    rowFilter: parseRowFilter(process.env.ROW_FILTER),
    actionDelayMin: parseInt(process.env.ACTION_DELAY_MIN ?? "0", 10),
    actionDelayMax: parseInt(process.env.ACTION_DELAY_MAX ?? "0", 10),
    financeUrl: fileConfig.financeUrl ?? "https://vwmelrose.hatfieldgroup.co.za/finance",
    skipProcessed:
      cliFlag("skip-processed") || parseBool(process.env.SKIP_PROCESSED, false),
    keepLastOpen: cliFlag("keep-last-open") || parseBool(process.env.KEEP_LAST_OPEN, false),
    screenshots:
      cliFlag("screenshots") || parseBool(process.env.SCREENSHOTS, dryRun),
    verifyFills:
      cliFlag("verify") ||
      parseBool(process.env.VERIFY_FILLS, false) ||
      strictMode,
    sheetId:
      process.env.SHEET_ID ||
      fileConfig.sheetId ||
      extractSheetId(
        process.env.SHEET_CSV_URL || fileConfig.sheetCsvUrl || DEFAULT_SHEET_CSV_URL
      ) ||
      DEFAULT_SHEET_ID,
    // Prefer SHEET_WEBHOOK_ID when the full URL secret is redacted.
    // Also strip NAME= prefixes / extract an embedded /exec URL.
    sheetWebhookUrl: resolveWebhookUrl(
      normalizeEnvValue(process.env.SHEET_WEBHOOK_ID, "SHEET_WEBHOOK_ID"),
      normalizeEnvValue(process.env.SHEET_WEBHOOK_URL, "SHEET_WEBHOOK_URL"),
      fileConfig.sheetWebhookUrl
    ),
    googleServiceAccountFile:
      normalizeEnvValue(
        process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
        "GOOGLE_SERVICE_ACCOUNT_FILE"
      ) ||
      fileConfig.googleServiceAccountFile ||
      "",
    loadedSheetId:
      normalizeEnvValue(process.env.LOADED_SHEET_ID, "LOADED_SHEET_ID") ||
      fileConfig.loadedSheetId ||
      "1V8re1qmdC0AXyDKt9G3gQxcqmn3q9hAJeM_YpUkjRLM",
    loadedSheetWebhookUrl: resolveWebhookUrl(
      normalizeEnvValue(process.env.SHEET_WEBHOOK_ID, "SHEET_WEBHOOK_ID"),
      normalizeEnvValue(process.env.LOADED_SHEET_WEBHOOK_URL, "LOADED_SHEET_WEBHOOK_URL") ||
        normalizeEnvValue(process.env.SHEET_WEBHOOK_URL, "SHEET_WEBHOOK_URL"),
      fileConfig.loadedSheetWebhookUrl || fileConfig.sheetWebhookUrl
    ),
    loadedNameColumn: process.env.LOADED_NAME_COLUMN || fileConfig.loadedNameColumn || "Name",
    loadedNumberColumn:
      process.env.LOADED_NUMBER_COLUMN || fileConfig.loadedNumberColumn || "Number",
    geminiApiKey:
      normalizeEnvValue(process.env.GEMINI_API_KEY, "GEMINI_API_KEY") ||
      normalizeEnvValue(process.env.GOOGLE_API_KEY, "GOOGLE_API_KEY") ||
      "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    intakeSpreadsheetId:
      normalizeEnvValue(process.env.INTAKE_SPREADSHEET_ID, "INTAKE_SPREADSHEET_ID") ||
      "1P7J0CipLKDvPjeLWiKSxuC8ZeWSAjzhbDsQwKFwWH6M",
    intakeStatusColumn: process.env.INTAKE_STATUS_COLUMN || "Enrichment Status",
    intakeMappingPath: process.env.INTAKE_MAPPING_PATH || "./config/intake-mapping.yaml",
    pollSeconds: parseInt(process.env.POLL_SECONDS ?? "60", 10) || 60,
    autoLoad: cliFlag("skip-load") ? false : parseBool(process.env.AUTO_LOAD, true),
    maxIntakeRows: parseMaxIntakeRows(process.env.MAX_INTAKE_ROWS, 0),
    leadsSpreadsheetId:
      process.env.LEADS_SPREADSHEET_ID ||
      process.env.LOADED_SHEET_ID ||
      fileConfig.loadedSheetId ||
      "1V8re1qmdC0AXyDKt9G3gQxcqmn3q9hAJeM_YpUkjRLM",
    leadsSheetGid: parseInt(process.env.LEADS_SHEET_GID ?? "1730847217", 10) || 1730847217,
    leadsNameColumn: process.env.LEADS_NAME_COLUMN || "Name",
    leadsNumberColumn: process.env.LEADS_NUMBER_COLUMN || "Number",
    leadsStatusColumn: process.env.LEADS_STATUS_COLUMN || "Status",
    leadsWhatsappSentColumn: process.env.LEADS_WHATSAPP_SENT_COLUMN || "WhatsApp sent",
    whatsapp: {
      provider: (process.env.WHATSAPP_PROVIDER || "meta").toLowerCase() === "custom" ? "custom" : "meta",
      apiUrl: process.env.WHATSAPP_API_URL || "",
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v21.0",
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      apiKey:
        process.env.WHATSAPP_ACCESS_TOKEN ||
        process.env.WHATSAPP_API_KEY ||
        process.env.WHATSAPP_TOKEN ||
        "",
      authHeader: process.env.WHATSAPP_AUTH_HEADER || "Authorization",
      authScheme:
        process.env.WHATSAPP_AUTH_SCHEME !== undefined
          ? process.env.WHATSAPP_AUTH_SCHEME
          : "Bearer",
      approveTemplate: process.env.WHATSAPP_APPROVE_TEMPLATE || "approve",
      declineTemplate: process.env.WHATSAPP_DECLINE_TEMPLATE || "decline",
      templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en",
      includeNameParameter: parseBool(process.env.WHATSAPP_INCLUDE_NAME_PARAM, false),
      phoneField: process.env.WHATSAPP_PHONE_FIELD || "to",
      templateField: process.env.WHATSAPP_TEMPLATE_FIELD || "template",
      nameField: process.env.WHATSAPP_NAME_FIELD || "name",
      bodyTemplate: process.env.WHATSAPP_BODY_TEMPLATE || "",
    },
  };
}

/** 0 or empty = unlimited. Negative / NaN falls back to the default. */
export function parseMaxIntakeRows(value: string | undefined, defaultValue = 0): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  const n = parseInt(value.trim(), 10);
  if (Number.isNaN(n) || n < 0) return defaultValue;
  return n;
}

export function loadColumnMapping(mappingPath: string): ColumnMapping {
  const absolute = resolve(mappingPath);
  const raw = readFileSync(absolute, "utf-8");
  return JSON.parse(raw) as ColumnMapping;
}
