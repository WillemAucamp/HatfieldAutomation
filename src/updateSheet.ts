/**
 * Arbitrary Google Sheet updates via the Apps Script webhook.
 *
 * Usage examples:
 *   npm run sheet-update -- --find Name="Thapelo Nyathi" --set Status=Approved Comment="ok"
 *   npm run sheet-update -- --a1 F2=Approved --a1 H2="note"
 *   npm run sheet-update -- --append Name="Jane Doe" Number=0821234567 Status=Pending
 *   npm run sheet-update -- --row 5 --set Status=Declined
 *   npm run sheet-update -- --insert-column-after C --header "Email sent" --dropdown Yes,No
 *
 * Defaults to the money / loaded-clients spreadsheet tab gid=2126384446.
 */
import { loadConfig } from "./config.js";

const DEFAULT_SPREADSHEET_ID = "1V8re1qmdC0AXyDKt9G3gQxcqmn3q9hAJeM_YpUkjRLM";
const DEFAULT_GID = 2126384446;

function parseAssign(raw: string): { key: string; value: string } {
  const eq = raw.indexOf("=");
  if (eq <= 0) throw new Error(`Expected Key=Value, got: ${raw}`);
  return { key: raw.slice(0, eq), value: raw.slice(eq + 1) };
}

function parseArgs(argv: string[]) {
  const payload: Record<string, unknown> = {
    action: "updateSheet",
    spreadsheetId: DEFAULT_SPREADSHEET_ID,
    sheetGid: DEFAULT_GID,
  };
  const updates: Array<Record<string, unknown>> = [];
  let find: Record<string, string> | undefined;
  let set: Record<string, string> | undefined;
  let append: Record<string, string> | undefined;
  let row: number | undefined;
  let insertAfter: string | undefined;
  let insertHeader: string | undefined;
  let dropdown: string | undefined;
  let validationColumn: string | undefined;

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
    } else if (arg === "--insert-column-after") {
      insertAfter = argv[++i];
    } else if (arg === "--header") {
      insertHeader = argv[++i];
    } else if (arg === "--dropdown" || arg === "--validation") {
      dropdown = argv[++i];
    } else if (arg === "--data-validation-column") {
      validationColumn = argv[++i];
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

  if (insertAfter) {
    payload.insertColumn = {
      after: insertAfter,
      ...(insertHeader ? { header: insertHeader } : {}),
      ...(dropdown ? { validation: dropdown.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    };
  } else if (validationColumn && dropdown) {
    payload.dataValidation = {
      column: validationColumn,
      options: dropdown.split(",").map((s) => s.trim()).filter(Boolean),
    };
  } else if (dropdown && insertHeader) {
    // Apply dropdown to an existing named column (no insert).
    payload.dataValidation = {
      column: insertHeader,
      options: dropdown.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }

  return payload;
}

function printHelp(): void {
  console.log(`Update the money Google Sheet via Apps Script webhook.

Examples:
  npm run sheet-update -- --find Name="Thapelo Nyathi" --set Status=Approved
  npm run sheet-update -- --a1 F2=Approved --a1 H2=note
  npm run sheet-update -- --row 5 --set Status=Declined Comment=ok
  npm run sheet-update -- --append Name="Jane Doe" Number=0821234567 Status=Pending
  npm run sheet-update -- --insert-column-after C --header "Email sent" --dropdown Yes,No
  npm run sheet-update -- --data-validation-column "Email sent" --dropdown Yes,No

Defaults:
  spreadsheet ${DEFAULT_SPREADSHEET_ID}
  gid         ${DEFAULT_GID}

Requires Apps Script redeploy with the updateSheet action
(including insertColumn / dataValidation support).`);
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
  if (
    !payload.find &&
    !payload.set &&
    !payload.append &&
    !payload.updates &&
    !payload.insertColumn &&
    !payload.dataValidation
  ) {
    printHelp();
    process.exit(1);
  }

  const config = loadConfig();
  if (!config.sheetWebhookUrl) {
    throw new Error("SHEET_WEBHOOK_URL is required");
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
