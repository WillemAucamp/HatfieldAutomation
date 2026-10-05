/**
 * n8n-facing HTTP triggers for Hatfield intake → Melrose.
 *
 * Does NOT change the Seriti fill pipeline — /load calls the existing runBatchMain.
 * /ingest calls the existing Gemini enrich + append (same as `npm run ingest`).
 *
 * Auth: Authorization: Bearer <TRIGGER_SECRET>  or  X-Trigger-Secret: <TRIGGER_SECRET>
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config as dotenvConfig } from "dotenv";
import { isAuthorized } from "./auth.js";
import {
  enqueueJob,
  getJob,
  getQueueSnapshot,
  listJobs,
  recoverQueueOnBoot,
} from "./queue.js";

dotenvConfig({ path: resolve(process.cwd(), ".env"), override: true });

const PORT = parseInt(process.env.TRIGGER_PORT ?? "8788", 10);
const SECRET = (process.env.TRIGGER_SECRET ?? "").trim();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const method = req.method ?? "GET";
  const pathname = pathnameOf(req);

  if (method === "GET" && pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "hatfield-n8n-triggers",
      queue: getQueueSnapshot(),
      secretConfigured: Boolean(SECRET),
    });
    return;
  }

  if (!SECRET) {
    sendJson(res, 503, {
      ok: false,
      error: "TRIGGER_SECRET is not configured on the server",
    });
    return;
  }

  if (!isAuthorized(req, SECRET)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  if (method === "GET" && pathname === "/jobs") {
    const url = new URL(req.url ?? "/", "http://localhost");
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    sendJson(res, 200, { ok: true, jobs: listJobs(limit), queue: getQueueSnapshot() });
    return;
  }

  if (method === "GET" && pathname.startsWith("/jobs/")) {
    const id = pathname.slice("/jobs/".length);
    const job = getJob(id);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "Job not found" });
      return;
    }
    sendJson(res, 200, { ok: true, job });
    return;
  }

  if (method === "POST" && pathname === "/ingest") {
    try {
      const job = enqueueJob({ kind: "ingest" });
      sendJson(res, 202, {
        ok: true,
        jobId: job.id,
        kind: job.kind,
        status: job.status,
        poll: `/jobs/${job.id}`,
      });
    } catch (err) {
      sendJson(res, 429, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/load") {
    let body: { rows?: number[] } = {};
    try {
      const raw = await readBody(req);
      if (raw.trim()) body = JSON.parse(raw) as { rows?: number[] };
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }
    try {
      const job = enqueueJob({ kind: "load", rows: body.rows });
      sendJson(res, 202, {
        ok: true,
        jobId: job.id,
        kind: job.kind,
        status: job.status,
        rows: job.rows,
        poll: `/jobs/${job.id}`,
      });
    } catch (err) {
      sendJson(res, 429, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

export function startTriggerServer(port = PORT): ReturnType<typeof createServer> {
  if (!SECRET) {
    console.warn(
      "WARNING: TRIGGER_SECRET is empty. /ingest and /load will return 503 until it is set."
    );
  }

  recoverQueueOnBoot();

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("Unhandled trigger error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: "Internal error" });
      }
    });
  });

  server.listen(port, () => {
    console.log(`Hatfield n8n triggers listening on :${port}`);
    console.log("  GET  /health");
    console.log("  POST /ingest   (Gemini enrich → automation sheet)");
    console.log("  POST /load     (existing Melrose/Seriti batch; optional {\"rows\":[n]})");
    console.log("  GET  /jobs/:id");
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startTriggerServer();
}
