import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { approvedLeadsToCarry } from "./loadedClientIdentity.js";
import { readUnprocessedIntake, readSheetRows } from "./intake/sheets.js";
import { isRepairableAutomationStatus } from "./repairableStatus.js";
import { readMoneySheetRows } from "./sheetWriter.js";
import type { AppConfig } from "./types.js";

export interface PendingWorkCounts {
  intake: number;
  loadable: number;
  approved: number;
}

export interface ScheduledPipelinePlan {
  shouldRun: boolean;
  intake: number;
  loadable: number;
  approved: number;
  reason: string;
}

/** Manual workflow_dispatch runs always execute ingest/load; polled ticks use {@link planScheduledPipeline}. */
export function resolvePipelinePlan(
  counts: PendingWorkCounts,
  applyIdleProbe: boolean
): ScheduledPipelinePlan {
  if (!applyIdleProbe) {
    return {
      shouldRun: true,
      intake: counts.intake,
      loadable: counts.loadable,
      approved: counts.approved,
      reason: "manual run — idle probe skipped",
    };
  }
  return planScheduledPipeline(counts);
}

/** Idle GitHub ticks skip Playwright when there is nothing to ingest, load, or copy. */
export function planScheduledPipeline(counts: PendingWorkCounts): ScheduledPipelinePlan {
  const intake = Math.max(0, counts.intake);
  const loadable = Math.max(0, counts.loadable);
  const approved = Math.max(0, counts.approved);
  const shouldRun = intake > 0 || loadable > 0 || approved > 0;
  let reason = "idle — no new Form rows, no blank/repairable Status, no Approved-tab copies";
  if (shouldRun) {
    const parts: string[] = [];
    if (intake > 0) parts.push(`${intake} unprocessed Form row(s)`);
    if (loadable > 0) parts.push(`${loadable} blank/repairable automation row(s)`);
    if (approved > 0) parts.push(`${approved} Approved lead(s) to copy`);
    reason = parts.join("; ");
  }
  return { shouldRun, intake, loadable, approved, reason };
}

export function githubOutputLines(plan: ScheduledPipelinePlan): string[] {
  return [
    `should_run=${plan.shouldRun}`,
    `intake=${plan.intake}`,
    `loadable=${plan.loadable}`,
    `approved=${plan.approved}`,
  ];
}

export async function countPendingWork(config: AppConfig): Promise<PendingWorkCounts> {
  if (!config.sheetWebhookUrl) {
    throw new Error("SHEET_WEBHOOK_URL is required to count pending work");
  }

  const intakeRows = await readUnprocessedIntake({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.intakeSpreadsheetId,
    statusColumn: config.intakeStatusColumn,
    sheetGid: config.intakeSheetGid,
    sheetName: config.intakeSheetName,
  });

  const automationRows = await readSheetRows({
    webhookUrl: config.sheetWebhookUrl,
    spreadsheetId: config.sheetId,
    unprocessedOnly: false,
    statusColumn: "Status",
  });
  const loadable = automationRows.filter((row) =>
    isRepairableAutomationStatus(row.values.Status ?? row.status)
  ).length;

  const leads = await readMoneySheetRows(
    config,
    config.leadsSheetGid,
    config.leadsNameColumn,
    config.leadsNumberColumn,
    config.leadsStatusColumn
  );
  const approvedTab = await readMoneySheetRows(
    config,
    config.approvedSheetGid,
    config.loadedNameColumn,
    config.loadedNumberColumn
  );
  const approved = approvedLeadsToCarry(leads, approvedTab).length;

  return { intake: intakeRows.length, loadable, approved };
}

function writeGithubOutput(plan: ScheduledPipelinePlan): void {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) return;
  appendFileSync(path, `${githubOutputLines(plan).join("\n")}\n`);
}

export async function pendingWorkMain(): Promise<number> {
  try {
    const config = loadConfig();
    const counts = await countPendingWork(config);
    const applyIdleProbe = process.env.APPLY_IDLE_PROBE === "true";
    const plan = resolvePipelinePlan(counts, applyIdleProbe);
    for (const line of githubOutputLines(plan)) {
      console.log(line);
    }
    console.log(plan.reason);
    writeGithubOutput(plan);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Pending-work probe failed (${message}); running the full pipeline.`);
    const plan: ScheduledPipelinePlan = {
      shouldRun: true,
      intake: -1,
      loadable: -1,
      approved: -1,
      reason: `probe failed: ${message}`,
    };
    for (const line of githubOutputLines(plan)) {
      console.log(line);
    }
    writeGithubOutput(plan);
    return 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  pendingWorkMain().then((code) => process.exit(code));
}
