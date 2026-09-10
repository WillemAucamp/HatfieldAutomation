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

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

function parseRowFilter(value: string | undefined): number[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

function cliFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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
    sheetWebhookUrl: process.env.SHEET_WEBHOOK_URL ?? fileConfig.sheetWebhookUrl ?? "",
    googleServiceAccountFile:
      process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? fileConfig.googleServiceAccountFile ?? "",
    loadedSheetId:
      process.env.LOADED_SHEET_ID ||
      fileConfig.loadedSheetId ||
      "1V8re1qmdC0AXyDKt9G3gQxcqmn3q9hAJeM_YpUkjRLM",
    loadedSheetWebhookUrl:
      process.env.LOADED_SHEET_WEBHOOK_URL ||
      fileConfig.loadedSheetWebhookUrl ||
      process.env.SHEET_WEBHOOK_URL ||
      fileConfig.sheetWebhookUrl ||
      "",
    loadedNameColumn: process.env.LOADED_NAME_COLUMN || fileConfig.loadedNameColumn || "Name",
    loadedNumberColumn:
      process.env.LOADED_NUMBER_COLUMN || fileConfig.loadedNumberColumn || "Number",
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    intakeSpreadsheetId:
      process.env.INTAKE_SPREADSHEET_ID || "1P7J0CipLKDvPjeLWiKSxuC8ZeWSAjzhbDsQwKFwWH6M",
    intakeStatusColumn: process.env.INTAKE_STATUS_COLUMN || "Enrichment Status",
    intakeMappingPath: process.env.INTAKE_MAPPING_PATH || "./config/intake-mapping.yaml",
    pollSeconds: parseInt(process.env.POLL_SECONDS ?? "60", 10) || 60,
    autoLoad: cliFlag("skip-load") ? false : parseBool(process.env.AUTO_LOAD, true),
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
      apiUrl: process.env.WHATSAPP_API_URL || "",
      apiKey: process.env.WHATSAPP_API_KEY || "",
      authHeader: process.env.WHATSAPP_AUTH_HEADER || "Authorization",
      authScheme:
        process.env.WHATSAPP_AUTH_SCHEME !== undefined
          ? process.env.WHATSAPP_AUTH_SCHEME
          : "Bearer",
      approveTemplate: process.env.WHATSAPP_APPROVE_TEMPLATE || "approve",
      declineTemplate: process.env.WHATSAPP_DECLINE_TEMPLATE || "decline",
      phoneField: process.env.WHATSAPP_PHONE_FIELD || "to",
      templateField: process.env.WHATSAPP_TEMPLATE_FIELD || "template",
      nameField: process.env.WHATSAPP_NAME_FIELD || "name",
      bodyTemplate: process.env.WHATSAPP_BODY_TEMPLATE || "",
    },
  };
}

export function loadColumnMapping(mappingPath: string): ColumnMapping {
  const absolute = resolve(mappingPath);
  const raw = readFileSync(absolute, "utf-8");
  return JSON.parse(raw) as ColumnMapping;
}
