/**
 * Serial job queue that runs the existing Playwright batch / retry pipeline
 * with per-client sheet env injected. One job at a time (Playwright is heavy).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { clientJobEnv, getClient, type ClientConfig } from "./clients.js";

export type JobKind = "run-open" | "retry-rows";
export type JobStatus = "queued" | "running" | "success" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  clientId: string;
  kind: JobKind;
  status: JobStatus;
  rows?: number[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  logTail?: string;
  triggeredBy: "client" | "operator";
  summary?: string;
}

const MAX_LOG_TAIL = 12_000;

function dataDir(): string {
  const dir = resolve(process.env.PRODUCT_DATA_DIR ?? "./data/product");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "jobs"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });
  return dir;
}

function jobPath(id: string): string {
  return join(dataDir(), "jobs", `${id}.json`);
}

function logPath(id: string): string {
  return join(dataDir(), "logs", `${id}.log`);
}

function saveJob(job: JobRecord): void {
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2) + "\n");
}

export function getJob(id: string): JobRecord | undefined {
  const path = jobPath(id);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as JobRecord;
}

export function listJobs(filter?: { clientId?: string; limit?: number }): JobRecord[] {
  const dir = join(dataDir(), "jobs");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let jobs = files
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf-8")) as JobRecord;
      } catch {
        return null;
      }
    })
    .filter((j): j is JobRecord => Boolean(j));
  if (filter?.clientId) {
    jobs = jobs.filter((j) => j.clientId === filter.clientId);
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (filter?.limit) jobs = jobs.slice(0, filter.limit);
  return jobs;
}

let queue: string[] = [];
let activeJobId: string | null = null;
let draining = false;

export function getQueueSnapshot(): { activeJobId: string | null; queued: string[] } {
  return { activeJobId, queued: [...queue] };
}

export function enqueueJob(input: {
  clientId: string;
  kind: JobKind;
  rows?: number[];
  triggeredBy: "client" | "operator";
}): JobRecord {
  const client = getClient(input.clientId);
  if (!client) throw new Error(`Unknown client: ${input.clientId}`);
  if (!client.enabled && input.triggeredBy === "client") {
    throw new Error(`Client ${input.clientId} is paused. Contact the operator.`);
  }
  if (!client.sheetId) throw new Error(`Client ${input.clientId} has no sheetId configured`);

  if (input.kind === "retry-rows") {
    const rows = (input.rows ?? []).filter((n) => Number.isInteger(n) && n >= 2);
    if (rows.length === 0) throw new Error("Retry requires at least one row number (>= 2)");
    input.rows = rows;
  }

  const runningForClient = listJobs({ clientId: input.clientId, limit: 20 }).some(
    (j) => j.status === "queued" || j.status === "running"
  );
  if (runningForClient) {
    throw new Error("A job is already queued or running for this client. Wait for it to finish.");
  }

  const job: JobRecord = {
    id: randomUUID(),
    clientId: input.clientId,
    kind: input.kind,
    status: "queued",
    rows: input.rows,
    createdAt: new Date().toISOString(),
    triggeredBy: input.triggeredBy,
  };
  saveJob(job);
  queue.push(job.id);
  void drainQueue();
  return job;
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0 && !activeJobId) {
      const nextId = queue.shift()!;
      const job = getJob(nextId);
      if (!job || job.status === "cancelled") continue;
      activeJobId = nextId;
      await runJob(job);
      activeJobId = null;
    }
  } finally {
    draining = false;
  }
}

async function runJob(job: JobRecord): Promise<void> {
  const client = getClient(job.clientId);
  if (!client) {
    job.status = "failed";
    job.error = `Client config missing: ${job.clientId}`;
    job.finishedAt = new Date().toISOString();
    saveJob(job);
    return;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();
  saveJob(job);

  const logFile = logPath(job.id);
  writeFileSync(logFile, `Job ${job.id} (${job.kind}) for ${job.clientId}\n`);

  try {
    const exitCode = await spawnPipeline(job, client, logFile);
    const logText = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";
    job.logTail = logText.slice(-MAX_LOG_TAIL);
    if (exitCode === 0) {
      job.status = "success";
      job.summary =
        job.kind === "retry-rows"
          ? `Retry finished for row(s) ${(job.rows ?? []).join(", ")}`
          : "Open-row batch finished";
    } else {
      job.status = "failed";
      job.error = `Pipeline exited with code ${exitCode}`;
    }
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    const logText = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";
    job.logTail = logText.slice(-MAX_LOG_TAIL);
  }

  job.finishedAt = new Date().toISOString();
  saveJob(job);
}

function spawnPipeline(
  job: JobRecord,
  client: ClientConfig,
  logFile: string
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const clientEnv = clientJobEnv(client);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...clientEnv,
      // Clear filters for open-row runs; retryRows sets ROW_FILTER itself after clear.
      ROW_FILTER: "",
    };

    const script =
      job.kind === "retry-rows" ? "src/retryRows.ts" : "src/runBatch.ts";
    const scriptArgs =
      job.kind === "retry-rows" ? (job.rows ?? []).map(String) : [];

    // Prefer local tsx binary; fall back to node --import tsx.
    const tsxBin = resolve(process.cwd(), "node_modules/.bin/tsx");
    const useTsxBin = existsSync(tsxBin);
    const child = useTsxBin
      ? spawn(tsxBin, [script, ...scriptArgs], {
          cwd: process.cwd(),
          env,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(process.execPath, ["--import", "tsx", script, ...scriptArgs], {
          cwd: process.cwd(),
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });

    const append = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      process.stdout.write(`[job:${job.id.slice(0, 8)}] ${text}`);
      writeFileSync(logFile, (existsSync(logFile) ? readFileSync(logFile, "utf-8") : "") + text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

/** Recover queued jobs after process restart. */
export function recoverQueueOnBoot(): void {
  const stuck = listJobs({ limit: 200 }).filter(
    (j) => j.status === "queued" || j.status === "running"
  );
  for (const job of stuck) {
    if (job.status === "running") {
      job.status = "failed";
      job.error = "Interrupted by server restart";
      job.finishedAt = new Date().toISOString();
      saveJob(job);
    } else {
      queue.push(job.id);
    }
  }
  void drainQueue();
}
