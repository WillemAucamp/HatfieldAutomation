import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { describe, it } from "node:test";
import { extractTriggerSecret, isAuthorized } from "./auth.js";

function fakeReq(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("trigger auth", () => {
  it("accepts Bearer token", () => {
    const secret = "test-secret-value-32chars!!!!!!";
    const req = fakeReq({ authorization: `Bearer ${secret}` });
    assert.equal(extractTriggerSecret(req), secret);
    assert.equal(isAuthorized(req, secret), true);
  });

  it("accepts X-Trigger-Secret", () => {
    const secret = "another-secret-value-32chars!!!";
    const req = fakeReq({ "x-trigger-secret": secret });
    assert.equal(isAuthorized(req, secret), true);
  });

  it("rejects wrong secret", () => {
    const req = fakeReq({ authorization: "Bearer wrong" });
    assert.equal(isAuthorized(req, "right-secret-here"), false);
  });

  it("rejects empty configured secret", () => {
    const req = fakeReq({ authorization: "Bearer anything" });
    assert.equal(isAuthorized(req, ""), false);
  });
});

describe("health route smoke", () => {
  it("responds without auth", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "hatfield-n8n-triggers" }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; service: string };
    assert.equal(body.ok, true);
    assert.equal(body.service, "hatfield-n8n-triggers");
    await new Promise<void>((r) => server.close(() => r()));
  });
});
