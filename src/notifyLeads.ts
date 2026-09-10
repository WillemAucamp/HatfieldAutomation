/**
 * Send pre-approved WhatsApp messages for Leads Status = Approved / Declined.
 *
 *   npm run notify-leads
 *   npm run notify-leads -- --once
 *   npm run notify-leads -- --row 5 --row 12
 *   npm run notify-leads -- --dry-run
 *   npm run notify-leads -- --ensure-column
 */
import { loadConfig } from "./config.js";
import { ensureWhatsAppSentColumn, notifyPendingLeads } from "./whatsapp/leads.js";

function parseRowFilter(argv: string[]): number[] {
  const rows: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--row" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (!Number.isNaN(n)) rows.push(n);
    }
  }
  return rows;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Notify Leads via WhatsApp when Status is Approved or Declined.

Usage:
  npm run notify-leads
  npm run notify-leads -- --dry-run
  npm run notify-leads -- --row 5
  npm run notify-leads -- --ensure-column

Requires:
  SHEET_WEBHOOK_URL
  WHATSAPP_API_URL
  WHATSAPP_API_KEY (if your API needs auth)
  Optional WHATSAPP_APPROVE_TEMPLATE / WHATSAPP_DECLINE_TEMPLATE / WHATSAPP_BODY_TEMPLATE`);
    return;
  }

  const config = loadConfig();
  const ensureOnly = argv.includes("--ensure-column");
  if (ensureOnly) {
    await ensureWhatsAppSentColumn(config);
    console.log(
      `Ensured column "${config.leadsWhatsappSentColumn}" on leads gid=${config.leadsSheetGid}`
    );
    return;
  }

  if (!config.whatsapp.apiUrl && !config.dryRun && !argv.includes("--dry-run")) {
    throw new Error(
      "WHATSAPP_API_URL is required. Add it to .env (and WHATSAPP_API_KEY if needed)."
    );
  }

  const summary = await notifyPendingLeads(config, {
    rowFilter: parseRowFilter(argv),
    ensureColumn: !argv.includes("--skip-ensure-column"),
    dryRun: argv.includes("--dry-run"),
  });

  console.log(
    JSON.stringify(
      {
        ok: summary.failed === 0,
        scanned: summary.scanned,
        pending: summary.pending,
        sent: summary.sent,
        skipped: summary.skipped,
        failed: summary.failed,
        results: summary.results.map((r) => ({
          rowIndex: r.rowIndex,
          name: r.name,
          status: r.status,
          ok: r.result.ok,
          skipped: r.result.skipped ?? false,
          reason: r.result.reason,
          phone: r.result.phoneE164,
          template: r.result.template,
          statusCode: r.result.statusCode,
        })),
      },
      null,
      2
    )
  );

  if (summary.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
