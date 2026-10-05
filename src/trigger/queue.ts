/**
 * Serial job queue for n8n HTTP triggers.
 * One ingest or Melrose load at a time — Playwright is heavy and sheet writes must not race.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { ingestNewRows, type IngestResult } from "../intake/ingest.js";
import { runBatchMain } from "../runBatch.js";

export type TriggerJobKind = "ingest" | "load";
export type TriggerJobStatus = "queued" | "running" | "success" | "failed";

export interface TriggerJobRecord {
  id: string;
  kind: TriggerJobKind;
  status: TriggerJobStatus;
  rows?: number[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: IngestResult | { loaded: "batch"; rowFilter: number[] };
}

const MAX_JOBS_LISTED = 50;

function dataDir(): string {
  const dir = resolve(process.env.TRIGGER_DATA_DIR ?? "./data/trigger");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "jobs"), { recursive: true });
  return dir;
}

function jobPath(id: string): string {
  return join(dataDir(), "jobs", `${id}.json`);
}

function saveJob(job: TriggerJobRecord): void {
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2) + "\n");
}

export function getJob(id: string): TriggerJobRecord | undefined {
  const path = jobPath(id);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as TriggerJobRecord;
}

export function listJobs(limit = 20): TriggerJobRecord[] {
  const dir = join(dataDir(), "jobs");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const jobs = files
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf-8")) as TriggerJobRecord;
      } catch {
        return null;
      }
    })
    .filter((j): j is TriggerJobRecord => Boolean(j));
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs.slice(0, Math.min(limit, MAX_JOBS_LISTED));
}

let queue: string[] = [];
let activeJobId: string | null = null;
let draining = false;

export function getQueueSnapshot(): { activeJobId: string | null; queued: string[] } {
  return { activeJobId, queued: [...queue] };
}

export function enqueueJob(input: {
  kind: TriggerJobKind;
  rows?: number[];
}): TriggerJobRecord {
  if (input.kind === "load" && input.rows) {
    const rows = input.rows.filter((n) => Number.isInteger(n) && n >= 2);
    if (input.rows.length > 0 && rows.length === 0) {
      throw new Error("load requires sheet row numbers >= 2");
    }
    input.rows = rows;
  }

  const busy = listJobs(30).some((j) => j.status === "queued" || j.status === "running");
  if (busy) {
    // Still enqueue — serial drain handles order — but reject storm of duplicates for same kind?
    // Allow queue; n8n may fire ingest then load. Cap queue depth.
    if (queue.length >= 10) {
      throw new Error("Trigger queue is full (max 10). Wait for running jobs to finish.");
    }
  }

  const job: TriggerJobRecord = {
    id: randomUUID(),
    kind: input.kind,
    status: "queued",
    rows: input.rows,
    createdAt: new Date().toISOString(),
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
      if (!job || job.status !== "queued") continue;
      activeJobId = nextId;
      await runJob(job);
      activeJobId = null;
    }
  } finally {
    draining = false;
  }
}

async function runJob(job: TriggerJobRecord): Promise<void> {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  saveJob(job);

  try {
    if (job.kind === "ingest") {
      const config = loadConfig();
      if (!config.geminiApiKey && !config.dryRun) {
        throw new Error("GEMINI_API_KEY is not set");
      }
      // Never auto-load Melrose from ingest — n8n calls /load separately.
      const result = await ingestNewRows({ ...config, autoLoad: false, dryRun: config.dryRun });
      job.result = result;
      job.status = "success";
    } else {
      const prevFilter = process.env.ROW_FILTER;
      const prevHeadless = process.env.HEADLESS;
      try {
        if (job.rows && job.rows.length > 0) {
          process.env.ROW_FILTER = job.rows.join(",");
        } else {
          delete process.env.ROW_FILTER;
        }
        process.env.HEADLESS = process.env.HEADLESS || "true";
        await runBatchMain();
        job.result = { loaded: "batch", rowFilter: job.rows ?? [] };
        job.status = "success";
      } finally {
        if (prevFilter === undefined) delete process.env.ROW_FILTER;
        else process.env.ROW_FILTER = prevFilter;
        if (prevHeadless === undefined) delete process.env.HEADLESS;
        else process.env.HEADLESS = prevHeadless;
      }
    }
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
  }

  job.finishedAt = new Date().toISOString();
  saveJob(job);
}

/** Re-queue jobs left queued after restart; mark interrupted running jobs failed. */
export function recoverQueueOnBoot(): void {
  const stuck = listJobs(200).filter((j) => j.status === "queued" || j.status === "running");
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
