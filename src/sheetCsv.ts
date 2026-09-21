/** Prefer gviz CSV — Google’s /export endpoint often returns 502 under load. */
export const DEFAULT_SHEET_ID = "12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI";

export function gvizCsvUrl(sheetId: string, gid = "0"): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

export function exportCsvUrl(sheetId: string, gid = "0"): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

export const DEFAULT_SHEET_CSV_URL = gvizCsvUrl(DEFAULT_SHEET_ID);

export function extractSheetId(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? "";
}

export function extractGid(url: string): string {
  const match = url.match(/[?&]gid=(\d+)/);
  return match?.[1] ?? "0";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidateUrls(preferred: string): string[] {
  const sheetId = extractSheetId(preferred) || DEFAULT_SHEET_ID;
  const gid = extractGid(preferred);
  const gviz = gvizCsvUrl(sheetId, gid);
  const exported = exportCsvUrl(sheetId, gid);
  const urls = [preferred, gviz, exported];
  return [...new Set(urls)];
}

function looksLikeHollowSheetCsv(text: string): boolean {
  // gviz occasionally returns rows with names but blank ID/mobile cells.
  // Prefer the next candidate URL (usually /export) in that case.
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 3) return false;
  try {
    // Lightweight check without pulling in papaparse here.
    const header = lines[0].toLowerCase();
    if (!header.includes("id number") || !header.includes("mobile")) return false;
    const cols = lines[0].split(",");
    const idIdx = cols.findIndex((c) => /id number/i.test(c.replace(/"/g, "")));
    const mobileIdx = cols.findIndex((c) => /^"?mobile number"?$/i.test(c.replace(/"/g, "").trim()) || /mobile number/i.test(c.replace(/"/g, "")));
    if (idIdx < 0) return false;
    let named = 0;
    let missingId = 0;
    for (const line of lines.slice(1, Math.min(lines.length, 40))) {
      const cells: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQ = !inQ;
          continue;
        }
        if (ch === "," && !inQ) {
          cells.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      cells.push(cur);
      const name = (cells[1] || cells[4] || "").trim();
      if (!name) continue;
      named++;
      if (!(cells[idIdx] || "").trim()) missingId++;
    }
    return named >= 3 && missingId / named >= 0.5;
  } catch {
    return false;
  }
}

/**
 * Fetch sheet CSV with retries and gviz↔export fallback.
 * Always sends a browser UA — Googleusercontent redirects are picky.
 */
export async function fetchSheetCsv(url: string, attemptsPerUrl = 3): Promise<string> {
  const urls = candidateUrls(url);
  const errors: string[] = [];

  for (const candidate of urls) {
    for (let attempt = 1; attempt <= attemptsPerUrl; attempt++) {
      try {
        const response = await fetch(candidate, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; HatfieldAutomation/1.0; +https://github.com/WillemAucamp/HatfieldAutomation)",
            Accept: "text/csv,text/plain,*/*",
          },
          redirect: "follow",
        });
        if (response.ok) {
          const text = await response.text();
          if (text.trim().startsWith("<")) {
            errors.push(`${candidate}: HTML instead of CSV`);
            break;
          }
          if (looksLikeHollowSheetCsv(text)) {
            errors.push(`${candidate}: CSV missing ID/mobile values (hollow export)`);
            break;
          }
          if (candidate !== url) {
            console.warn(`  [sheetCsv] Fell back to ${candidate}`);
          } else if (attempt > 1) {
            console.warn(`  [sheetCsv] Succeeded on attempt ${attempt}`);
          }
          return text;
        }
        const detail = `${candidate}: ${response.status} ${response.statusText}`;
        errors.push(detail);
        if (!isRetryableStatus(response.status) || attempt === attemptsPerUrl) break;
        await sleep(400 * attempt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${candidate}: ${msg}`);
        if (attempt === attemptsPerUrl) break;
        await sleep(400 * attempt);
      }
    }
  }

  throw new Error(`Failed to fetch sheet CSV. Tried: ${errors.join(" | ")}`);
}
