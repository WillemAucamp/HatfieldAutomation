# n8n orchestration (Option 1) — replace Cursor always-on agent

**Your remaining steps only:** [`config/YOU_DO.md`](./YOU_DO.md)  
**Importable workflow:** [`config/n8n-workflow-hatfield-intake.json`](./n8n-workflow-hatfield-intake.json)

This repo already does the real work:

| Step | Existing command / code | HTTP trigger |
| --- | --- | --- |
| Form → Gemini → automation sheet (35 cols) | `npm run ingest` | `POST /ingest` |
| Automation sheet → Seriti (unchanged) | `npm run dev` / `runBatchMain` | `POST /load` |

n8n only **starts** those jobs. It does not reimplement Gemini or Seriti.

## 1. Host the trigger server

Secrets on the host (not in Cursor):

```
TRIGGER_SECRET=<long random string>
GEMINI_API_KEY=…
SHEET_WEBHOOK_URL=https://script.google.com/macros/s/…/exec
HEADLESS=true
AUTO_LOAD=false
```

Run locally:

```bash
npm ci
npx playwright install chromium
npm run trigger-server
```

Or deploy with the included `Dockerfile` / `fly.toml` (port **8788**).

Check:

```bash
curl -s https://YOUR_HOST/health
```

## 2. Apps Script → n8n (Form submit)

1. Redeploy `apps-script/Code.gs` if needed (`hatfield-intake-1`).
2. Script properties:
   - `N8N_WEBHOOK_URL` = your n8n **Webhook** node Production URL  
   - `N8N_WEBHOOK_API_KEY` = optional shared header value  
3. Run `setupIntakeWatch` once (Form submit → n8n).
4. Remove `CURSOR_WEBHOOK_*` after cutover and **disable** the Cursor automation.

## 3. n8n Workflow A — ingest

1. **Webhook** (POST) — path e.g. `hatfield-intake`  
   - This is what Apps Script calls on Form submit.
2. **HTTP Request**
   - Method: `POST`
   - URL: `https://YOUR_HOST/ingest`
   - Header: `Authorization` = `Bearer {{TRIGGER_SECRET}}`
3. Optional: **Wait** + **HTTP Request** `GET /jobs/{{jobId}}` until `status` is `success` or `failed`.
4. On success, read `result.appendedSheetRows` from the job (after poll).

Auth header on the Apps Script → n8n webhook is independent of `TRIGGER_SECRET`. Use n8n’s webhook auth if you set `N8N_WEBHOOK_API_KEY`.

## 4. n8n Workflow B — Melrose / Seriti load

**Do not change the Seriti fill.** Only trigger it.

### Option B1 — chain after ingest (simplest)

After Workflow A’s ingest job succeeds:

1. **HTTP Request** `POST https://YOUR_HOST/load`  
   - Body: `{ "rows": [ …appendedSheetRows… ] }`  
   - Same `Authorization: Bearer …`
2. Empty `rows` / omit body → loader processes all blank-**Status** rows (same as a manual full run of open rows).

### Option B2 — separate sheet trigger

If you prefer sheet-driven:

1. Google Sheets trigger on the **automation** sheet when a row is added / Status is blank.
2. Debounce ~30s (Gemini append can touch several cells).
3. `POST /load` with that row number or with no filter.

At ~8 rows/day, **B1 is enough**.

## 5. Cutover checklist

1. Fake Form submit → Workflow A fires → automation sheet gains a 35-col row with blank Status.  
2. `/load` runs → Seriti fill → Status gets `ZAHTVW…` or `error …`.  
3. Disable Cursor always-on agent (`config/cursor-automation.md` is obsolete for production).  
4. Disable or delete `.github/workflows/intake-to-melrose.yml` schedule if it would double-run.

## API quick reference

| Method | Path | Auth | Effect |
| --- | --- | --- | --- |
| GET | `/health` | no | Liveness + queue snapshot |
| POST | `/ingest` | Bearer / `X-Trigger-Secret` | Queue Gemini enrich (no Melrose) |
| POST | `/load` | same | Queue existing Melrose batch; body optional `{ "rows": [2,3] }` |
| GET | `/jobs/:id` | same | Job status + result |

All mutating calls return **202** with `{ jobId, poll }` and run **serially** on the host.
