/** Prefer /export CSV — gviz silently blanks text-formatted ID and phone cells. */
export const DEFAULT_SHEET_ID = "12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI";

export function gvizCsvUrl(sheetId: string, gid = "0"): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

export function exportCsvUrl(sheetId: string, gid = "0"): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

export const DEFAULT_SHEET_CSV_URL = exportCsvUrl(DEFAULT_SHEET_ID);

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

/** /export first: gviz returns 200 but drops @-formatted ID/phone/expense cells. */
export function csvCandidateUrls(preferred: string): string[] {
  const sheetId = extractSheetId(preferred) || DEFAULT_SHEET_ID;
  const gid = extractGid(preferred);
  const exported = exportCsvUrl(sheetId, gid);
  const gviz = gvizCsvUrl(sheetId, gid);
  return [...new Set([exported, preferred, gviz])];
}

/**
 * Fetch sheet CSV with retries. Tries /export first, then the preferred URL, then gviz.
 * Always sends a browser UA — Googleusercontent redirects are picky.
 */
export async function fetchSheetCsv(url: string, attemptsPerUrl = 3): Promise<string> {
  const urls = csvCandidateUrls(url);
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
          if (candidate !== urls[0]) {
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
