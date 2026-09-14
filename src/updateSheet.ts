/**
 * Arbitrary Google Sheet updates via the Apps Script webhook.
 *
 * Usage examples:
 *   npm run sheet-update -- --spreadsheet <SHEET_ID> --find Name="Thapelo Nyathi" --set Status=Approved Comment="ok"
 *   npm run sheet-update -- --spreadsheet <SHEET_ID> --a1 F2=Approved --a1 H2="note"
 *   npm run sheet-update -- --spreadsheet <SHEET_ID> --append Name="Jane Doe" Number=0821234567 Status=Pending
 *   npm run sheet-update -- --spreadsheet <SHEET_ID> --row 5 --set Status=Declined
 *
 * Pass --spreadsheet (or LOADED_SHEET_ID / SHEET_ID in env). No personal sheet IDs are hard-coded.
 */
import { loadConfig } from "./config.js";

function parseAssign(raw: string): { key: string; value: string } {
  const eq = raw.indexOf("=");
  if (eq <= 0) throw new Error(`Expected Key=Value, got: ${raw}`);
  return { key: raw.slice(0, eq), value: raw.slice(eq + 1) };
}

function parseArgs(argv: string[]) {
  const payload: Record<string, unknown> = {
    action: "updateSheet",
  };
  const updates: Array<Record<string, unknown>> = [];
  let find: Record<string, string> | undefined;
  let set: Record<string, string> | undefined;
  let append: Record<string, string> | undefined;
  let row: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--spreadsheet" || arg === "--spreadsheet-id") {
      payload.spreadsheetId = argv[++i];
    } else if (arg === "--gid" || arg === "--sheet-gid") {
      payload.sheetGid = Number(argv[++i]);
    } else if (arg === "--sheet-name") {
      payload.sheetName = argv[++i];
    } else if (arg === "--find") {
      const { key, value } = parseAssign(argv[++i]);
      find = { column: key, equals: value };
    } else if (arg === "--set") {
      set = set ?? {};
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        const { key, value } = parseAssign(argv[++i]);
        set[key] = value;
      }
    } else if (arg === "--append") {
      append = append ?? {};
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        const { key, value } = parseAssign(argv[++i]);
        append[key] = value;
      }
    } else if (arg === "--a1") {
      const { key, value } = parseAssign(argv[++i]);
      updates.push({ a1: key, value });
    } else if (arg === "--row") {
      row = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (find) payload.find = find;
  if (set && row) {
    for (const [column, value] of Object.entries(set)) {
      updates.push({ row, column, value });
    }
  } else if (set) {
    payload.set = set;
  }
  if (append) payload.append = append;
  if (updates.length) payload.updates = updates;

  return payload;
}

function printHelp(): void {
  console.log(`Update a Google Sheet via Apps Script webhook.

Examples:
  npm run sheet-update -- --spreadsheet <SHEET_ID> --find Name="Thapelo Nyathi" --set Status=Approved
  npm run sheet-update -- --spreadsheet <SHEET_ID> --a1 F2=Approved --a1 H2=note
  npm run sheet-update -- --spreadsheet <SHEET_ID> --row 5 --set Status=Declined Comment=ok
  npm run sheet-update -- --spreadsheet <SHEET_ID> --append Name="Jane Doe" Number=0821234567 Status=Pending

Requires --spreadsheet or LOADED_SHEET_ID / SHEET_ID in the environment.
Requires Apps Script with the updateSheet action.`);
}

async function postWebhook(
  url: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "manual",
    body: JSON.stringify(payload),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Webhook redirected without Location header");
    const followed = await fetch(location, { method: "GET", redirect: "follow" });
    const body = await followed.text();
    return JSON.parse(body) as Record<string, unknown>;
  }

  const body = await response.text();
  if (!response.ok) throw new Error(`Webhook ${response.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const payload = parseArgs(process.argv.slice(2));
  if (!payload.find && !payload.set && !payload.append && !payload.updates) {
    printHelp();
    process.exit(1);
  }

  const config = loadConfig();
  if (!payload.spreadsheetId) {
    payload.spreadsheetId = config.loadedSheetId || config.sheetId || "";
  }
  if (!payload.spreadsheetId) {
    throw new Error(
      "Pass --spreadsheet <SHEET_ID> or set LOADED_SHEET_ID / SHEET_ID for the target client sheet."
    );
  }
  if (!config.sheetWebhookUrl) {
    throw new Error("SHEET_WEBHOOK_URL (or SHEET_WEBHOOK_ID) is required");
  }

  console.log("Sending updateSheet payload:");
  console.log(JSON.stringify(payload, null, 2));
  const result = await postWebhook(config.sheetWebhookUrl, payload);
  console.log("Result:", JSON.stringify(result, null, 2));
  if (result.ok === false) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
