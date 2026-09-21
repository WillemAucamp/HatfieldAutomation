# What only you (Willem) can provide

The product code, button UI, runner, and docs are in the repo.  
These items **cannot** be completed by the agent alone:

## 1. Host the runner (required)

Pick one and deploy this repo’s Docker image / `npm run product`:

- `docker compose up -d --build` on any VPS
- Render (`render.yaml`)
- Fly.io (`fly.toml`)

Then set in `.env`:

```bash
PRODUCT_PUBLIC_URL=https://your-real-hostname
```

Without a public URL, the client has nowhere to click.

## 2. Apps Script write-back (required)

Under a Google account that can **edit** the client’s sheet(s):

1. Open their applicant sheet → Extensions → Apps Script  
2. Paste `apps-script/Code.gs`  
3. Deploy → Web app → Execute as **Me**, Who has access **Anyone**  
4. Copy the deployment id into:

```bash
SHEET_WEBHOOK_ID=AKfycb…
```

Checklist: `docs/APPS_SCRIPT_CHECKLIST.md`

## 3. Client sheet IDs (required)

From the client’s Google Sheet URL:

`https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit`

```bash
npm run new-client -- --id their-slug --name "Their Dealership" --sheet THEIR_SHEET_ID [--loaded OPTIONAL_LOADED_ID] --print-email
npm run validate-sheet -- --client their-slug
```

Do **not** use your personal App Automation / money sheet IDs for them.

## 4. Send the handoff (required)

`npm run new-client` writes `clients/<id>.handoff.txt` — email that to them.

They need only:

1. Runner URL (`PRODUCT_PUBLIC_URL`)  
2. Their access token  
3. “Leave Status blank → Run open rows”

---

### Quick self-check

```bash
npm run bootstrap-secrets   # generates OPERATOR_TOKEN locally
npm run readiness           # prints OK vs NEED
```

Anything marked **NEED** that says “YOU must…” is still on you.
