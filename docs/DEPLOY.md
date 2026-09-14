# Deploy guide (operator)

Ship the product UI + Playwright runner on a machine you control. Clients only get the URL + their token.

## Prerequisites

- Node 18+
- Chromium deps for Playwright
- Apps Script web app deployed from `apps-script/Code.gs` (Execute as Me, Anyone) with edit access to each client sheet you will write
- Public CSV access on applicant sheets (or use a service account later)

## 1. Install

```bash
git clone <this-repo>
cd HatfieldAutomation
npm install
npm run install-browsers
cp .env.example .env
```

## 2. Operator secrets (`.env`)

```bash
# Shared write-back (prefer deployment id — survives secret redaction)
SHEET_WEBHOOK_ID=AKfycb...your_deployment_id...

# Product auth
OPERATOR_TOKEN=generate-a-long-random-string
CLIENT_API_TOKENS=acme:client-token-here,other:another-token

# Product bind
PRODUCT_PORT=8787
HEADLESS=true
```

Do **not** put your personal App Automation / money sheet IDs in production defaults. Each client gets their own IDs in `clients/*.json`.

## 3. Register a client

```bash
cp clients/_example.json clients/acme.json
# edit sheetId / loadedSheetId / displayName
```

Optional token file (gitignored pattern):

```bash
cp clients/_example.secrets.json clients/acme.secrets.json
# set apiToken
```

Or put the token only in `CLIENT_API_TOKENS`.

Confirm required columns (see `docs/CLIENT_GUIDE.md` / `mapping.json`). If headers differ, copy `mapping.json` → `clients/acme.mapping.json` and set `"mappingPath": "./clients/acme.mapping.json"`.

## 4. Apps Script on client sheets

1. Open the **client’s** applicant sheet (or loaded sheet) → Extensions → Apps Script.
2. Paste `apps-script/Code.gs`.
3. Deploy → Web app → Execute as Me, Anyone.
4. Put the deployment id in `SHEET_WEBHOOK_ID` (shared) or `webhookDeploymentId` on that client.
5. Ensure the Google account that owns the deployment can **edit** both sheets.

## 5. Run the product

```bash
npm run product
# or
npm run product:dev
```

Open `http://<host>:8787`. Sign in with `OPERATOR_TOKEN` to smoke-test, then give the client their token only.

## 6. Docker (optional)

```bash
docker build -t hatfield-product .
docker run --env-file .env -p 8787:8787 \
  -v "$PWD/clients:/app/clients" \
  -v "$PWD/data:/app/data" \
  hatfield-product
```

## 7. Iterate without changing the client habit

| Change | Action |
|--------|--------|
| Form / Seriti selectors | Edit `src/sections/*`, redeploy |
| Column headers | Edit mapping path for that client, restart |
| New client | Add `clients/<id>.json` + token, restart (or hot-read on next request — configs are read from disk each list) |
| Pause client | `"enabled": false` in their JSON |
| Rotate client token | Update `CLIENT_API_TOKENS` / secrets file |
| Rotate webhook | New Apps Script deployment → update `SHEET_WEBHOOK_ID` |

Client UI stays: open URL → token → **Run open rows**.

## 8. Debug

- Client sheet **Status** shows `error CODE` (same codes as README).
- Job log: `data/product/logs/<job-id>.log`
- Job JSON: `data/product/jobs/<job-id>.json`
- Operator can Retry row N from the UI or CLI:  
  `SHEET_ID=… SHEET_CSV_URL=… npm run retry -- 18`

Common: bad RSA ID → `PERSONAL_NEXT_FAILED` / `ID_NOT_13_DIGITS`. Fix cell, Retry.
