import type { IncomingMessage } from "node:http";

export function extractTriggerSecret(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  const x = req.headers["x-trigger-secret"];
  if (typeof x === "string") return x.trim();
  if (Array.isArray(x) && x[0]) return String(x[0]).trim();
  return "";
}

export function isAuthorized(req: IncomingMessage, secret: string): boolean {
  if (!secret) return false;
  const provided = extractTriggerSecret(req);
  if (!provided || provided.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < secret.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0;
}
