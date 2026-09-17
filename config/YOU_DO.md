# What only Willem can do (everything else is done in this PR)

I cannot log into your Google account, n8n, Cursor Automations UI, Fly/Render, or GitHub Actions secrets from this agent. Do these in order.

## 0. Fix the Cursor cloud secret shape (2 minutes)

`SHEET_WEBHOOK_URL` in Cloud Agent secrets is currently stored like:

`SHEET_WEBHOOK_URL=https://script.google.com/.../exec`

It must be **only** the URL:

`https://script.google.com/.../exec`

(The code now strips the bad prefix, but fix the secret so other tools stop breaking.)

## 1. Host the trigger server (required)

Pick one:

**A — Render (easiest with this repo)**  
1. https://dashboard.render.com → New → Blueprint  
2. Select repo `HatfieldAutomation`, branch `cursor/n8n-http-triggers-e278`, file `render.yaml`  
3. Set secrets: `TRIGGER_SECRET`, `GEMINI_API_KEY`, `SHEET_WEBHOOK_URL` (URL only)  
4. Copy the public URL, e.g. `https://hatfield-n8n-triggers.onrender.com`

**B — Fly.io**  
Use `fly.toml` + `Dockerfile`. Set the same three secrets. Note the HTTPS app URL.

**C — Any VPS/Docker**  
`docker build -t hatfield-triggers . && docker run -p 8788:8788 -e …`

Generate a strong `TRIGGER_SECRET` (e.g. `openssl rand -hex 32`). Keep it for n8n.

Smoke after deploy:

```bash
curl -s https://YOUR_HOST/health
curl -s -X POST https://YOUR_HOST/ingest -H "Authorization: Bearer YOUR_SECRET"
# expect 202 + jobId
```

## 2. n8n workflow (required)

1. Open your n8n → Workflows → Import from File  
2. Import `config/n8n-workflow-hatfield-intake.json` from this branch  
3. Set n8n environment variables:
   - `HATFIELD_TRIGGER_URL` = `https://YOUR_HOST` (no trailing slash)
   - `HATFIELD_TRIGGER_SECRET` = same as server `TRIGGER_SECRET`
4. Activate the workflow  
5. Copy the **Production Webhook URL** for path `hatfield-intake`

Optional: lengthen the Wait node if Gemini+sheet append often takes >5s (poll until `job.status` is `success`).

## 3. Apps Script → n8n (required, Google login)

1. Open either spreadsheet → Extensions → Apps Script  
2. Paste latest `apps-script/Code.gs` from this branch if not already deployed  
3. Deploy → Manage deployments → Edit → **New version** → Deploy  
   (version string should be `hatfield-intake-1` when GET works; POST `readSheet` already works on the live webhook)  
4. Project Settings → Script properties:
   - `N8N_WEBHOOK_URL` = n8n Production Webhook URL from step 2  
   - `N8N_WEBHOOK_API_KEY` = optional shared secret if you protect the n8n webhook  
5. Run function `setupIntakeWatch` once  
6. Remove `CURSOR_WEBHOOK_URL` / `CURSOR_WEBHOOK_API_KEY` after cutover

## 4. Disable Cursor always-on agent (required — token burn)

1. https://cursor.com/automations  
2. Find **Hatfield intake to Melrose** (or similar)  
3. Toggle **Off** / delete  

## 5. Backlog of old Form rows (decision — do not auto-run)

Doctor currently sees **dozens of unprocessed intake rows** (Enrichment Status empty).  
**Do not** point n8n at production until you decide:

- Mark old rows’ **Enrichment Status** as `skipped_historical` (or similar) so only new Form submits run, **or**  
- Intentionally process them in a controlled batch (`npm run ingest` then review Sheet 2 before `/load`)

I did **not** run ingest against those live rows from this agent.

## 6. First live test

1. Submit a **fake** Google Form response  
2. Confirm n8n execution → automation sheet gets a 35-col row with blank Status  
3. Confirm `/load` runs Seriti and writes Status  
4. Only then allow real clients

---

Done already in-repo: HTTP `/ingest` + `/load`, auth, queue, Docker/Fly/Render configs, Apps Script n8n props, n8n import JSON, doctor hardened, webhook URL normalize, Cursor automation docs deprecated.
