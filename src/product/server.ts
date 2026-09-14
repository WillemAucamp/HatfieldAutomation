/**
 * Product HTTP server: authenticated client “Run now” UI + operator controls.
 * Wraps the existing Playwright pipeline; does not reimplement Seriti fill logic.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config as dotenvConfig } from "dotenv";
import {
  authenticateBearer,
  getClient,
  listClientConfigs,
  requiredColumnsDoc,
  toPublicView,
  type AuthResult,
} from "./clients.js";
import {
  enqueueJob,
  getJob,
  getQueueSnapshot,
  listJobs,
  recoverQueueOnBoot,
  type JobKind,
} from "./jobs.js";

dotenvConfig();

const PUBLIC_DIR = resolve(process.env.PRODUCT_PUBLIC_DIR ?? "./src/product/public");
const PORT = parseInt(process.env.PRODUCT_PORT ?? "8787", 10);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

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

function parseAuth(req: IncomingMessage): AuthResult | null {
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const queryToken =
    typeof req.url === "string" && req.url.includes("token=")
      ? new URL(req.url, "http://localhost").searchParams.get("token") ?? ""
      : "";
  return authenticateBearer(bearer || queryToken || undefined);
}

function serveStatic(res: ServerResponse, urlPath: string): void {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  if (rel.includes("..")) {
    res.writeHead(400).end("Bad path");
    return;
  }
  const filePath = join(PUBLIC_DIR, rel);
  if (!existsSync(filePath)) {
    res.writeHead(404).end("Not found");
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "hatfield-product",
      queue: getQueueSnapshot(),
      clients: listClientConfigs().length,
    });
    return;
  }

  if (method === "GET" && pathname === "/api/required-columns") {
    sendJson(res, 200, { columns: requiredColumnsDoc() });
    return;
  }

  const auth = parseAuth(req);

  if (method === "POST" && pathname === "/api/login") {
    const raw = await readBody(req);
    let token = "";
    try {
      token = String((JSON.parse(raw) as { token?: string }).token ?? "");
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }
    const result = authenticateBearer(token);
    if (!result) {
      sendJson(res, 401, { error: "Invalid token" });
      return;
    }
    if (result.role === "operator") {
      sendJson(res, 200, {
        role: "operator",
        clients: listClientConfigs().map(toPublicView),
      });
      return;
    }
    sendJson(res, 200, {
      role: "client",
      client: toPublicView(result.client!),
    });
    return;
  }

  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (method === "GET" && pathname === "/api/me") {
    if (auth.role === "operator") {
      sendJson(res, 200, {
        role: "operator",
        clients: listClientConfigs().map(toPublicView),
        queue: getQueueSnapshot(),
      });
      return;
    }
    sendJson(res, 200, { role: "client", client: toPublicView(auth.client!) });
    return;
  }

  if (method === "GET" && pathname === "/api/jobs") {
    const url = new URL(req.url ?? "/", "http://localhost");
    const clientId =
      auth.role === "operator"
        ? url.searchParams.get("clientId") ?? undefined
        : auth.clientId;
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    sendJson(res, 200, { jobs: listJobs({ clientId, limit }) });
    return;
  }

  if (method === "GET" && pathname.startsWith("/api/jobs/")) {
    const id = pathname.slice("/api/jobs/".length);
    const job = getJob(id);
    if (!job) {
      sendJson(res, 404, { error: "Job not found" });
      return;
    }
    if (auth.role === "client" && job.clientId !== auth.clientId) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
    sendJson(res, 200, { job });
    return;
  }

  if (method === "POST" && pathname === "/api/runs") {
    const raw = await readBody(req);
    let body: {
      kind?: JobKind;
      rows?: number[];
      clientId?: string;
    };
    try {
      body = JSON.parse(raw || "{}") as typeof body;
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    const kind: JobKind = body.kind === "retry-rows" ? "retry-rows" : "run-open";
    let clientId: string;
    if (auth.role === "operator") {
      clientId = String(body.clientId ?? "");
      if (!clientId || !getClient(clientId)) {
        sendJson(res, 400, { error: "operator must pass a valid clientId" });
        return;
      }
    } else {
      clientId = auth.clientId!;
    }

    try {
      const job = enqueueJob({
        clientId,
        kind,
        rows: body.rows,
        triggeredBy: auth.role,
      });
      sendJson(res, 202, { job });
    } catch (err) {
      sendJson(res, 409, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (auth.role === "operator" && method === "GET" && pathname === "/api/operator/clients") {
    sendJson(res, 200, {
      clients: listClientConfigs().map((c) => ({
        ...toPublicView(c),
        mappingPath: c.mappingPath,
        notes: c.notes,
      })),
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }
    serveStatic(res, pathname);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startProductServer(): void {
  if (!(process.env.OPERATOR_TOKEN ?? "").trim()) {
    console.warn(
      "[product] OPERATOR_TOKEN is not set — operator login will fail until you set it."
    );
  }
  recoverQueueOnBoot();
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(PORT, () => {
    console.log(`Product UI listening on http://0.0.0.0:${PORT}`);
    console.log(`Clients dir: ${resolve(process.env.CLIENTS_DIR ?? "./clients")}`);
    console.log(`Configured clients: ${listClientConfigs().map((c) => c.id).join(", ") || "(none)"}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startProductServer();
}
