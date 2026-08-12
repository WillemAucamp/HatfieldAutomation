import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ApplicantRunResult, BatchRunLog, FieldWarning } from "./types.js";

export class RunLogger {
  private readonly runDir: string;
  private readonly batchId: string;
  private readonly logPath: string;
  private readonly dryRun: boolean;
  private readonly startedAt: string;
  private results: ApplicantRunResult[] = [];

  constructor(outputRoot: string, dryRun: boolean) {
    this.batchId = new Date().toISOString().replace(/[:.]/g, "-");
    this.runDir = join(outputRoot, this.batchId);
    this.logPath = join(this.runDir, "run-log.json");
    this.dryRun = dryRun;
    this.startedAt = new Date().toISOString();
    mkdirSync(this.runDir, { recursive: true });
  }

  getRunDir(): string {
    return this.runDir;
  }

  applicantDir(rowIndex: number, name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
    const dir = join(this.runDir, `row-${rowIndex}-${safeName}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  appendResult(result: ApplicantRunResult): void {
    this.results.push(result);
    this.flush();
  }

  flush(): void {
    const log: BatchRunLog = {
      batchId: this.batchId,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: this.dryRun,
      results: this.results,
    };
    writeFileSync(this.logPath, JSON.stringify(log, null, 2));
  }

  appendCsvSummary(result: ApplicantRunResult): void {
    const csvPath = join(this.runDir, "run-log.csv");
    const header =
      "rowIndex,rowId,applicantName,status,sectionReached,warningCount,error,startedAt,finishedAt\n";
    const line = [
      result.rowIndex,
      result.rowId,
      `"${result.applicantName.replace(/"/g, '""')}"`,
      result.status,
      result.sectionReached,
      result.warnings.length,
      result.error ? `"${result.error.replace(/"/g, '""')}"` : "",
      result.startedAt,
      result.finishedAt,
    ].join(",");

    if (!existsSync(csvPath)) {
      writeFileSync(csvPath, header + line + "\n");
    } else {
      appendFileSync(csvPath, line + "\n");
    }
  }
}

export function createWarning(
  field: string,
  section: string,
  message: string,
  screenshotPath?: string
): FieldWarning {
  return { field, section, message, screenshotPath };
}
