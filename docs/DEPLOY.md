# Deploy guide (operator)

Ship the product UI + Playwright runner on a machine you control. Clients only get the URL + their token.

**Start here if you want the shortest path:** [YOU_PROVIDE.md](./YOU_PROVIDE.md) (only the steps an agent cannot do for you).

## Prerequisites

- Node 18+ **or** Docker
- Chromium deps for Playwright (handled by the Docker image)
- Apps Script web app from `apps-script/Code.gs` — [APPS_SCRIPT_CHECKLIST.md](./APPS_SCRIPT_CHECKLIST.md)
- Client’s sheet ID(s)

## Fast path

```bash
npm install
npm run install-browsers
npm run bootstrap-secrets          # writes OPERATOR_TOKEN into .env
# edit .env → SHEET_WEBHOOK_ID=…  (after Apps Script deploy)

npm run new-client -- --id acme --name "Acme Motors" --sheet THEIR_SHEET_ID --print-email
npm run validate-sheet -- --client acme
npm run readiness

# Local
npm run product

# Or cloud-ish on a VPS
docker compose up -d --build
```

Then set `PRODUCT_PUBLIC_URL` to the public hostname and send `clients/acme.handoff.txt`.

## Operator secrets (`.env`)

```bash
SHEET_WEBHOOK_ID=AKfycb...your_deployment_id...
OPERATOR_TOKEN=…                 # from bootstrap-secrets
CLIENT_API_TOKENS=acme:…         # optional if using clients/acme.secrets.json
PRODUCT_PORT=8787
PRODUCT_PUBLIC_URL=https://loads.example.com
HEADLESS=true
```

Do **not** put personal App Automation / money sheet IDs in production defaults. Each client gets IDs via `npm run new-client`.

## Register a client

```bash
npm run new-client -- --id acme --name "Acme Motors" --sheet SHEET_ID [--loaded LOADED_ID] --print-email
```

Creates:

- `clients/acme.json` — sheet config  
- `clients/acme.secrets.json` — API token (gitignored)  
- `clients/acme.handoff.txt` — email body for the client  

If headers differ, copy `mapping.json` → `clients/acme.mapping.json` and set `"mappingPath"` in their JSON.

## Apps Script

Follow [APPS_SCRIPT_CHECKLIST.md](./APPS_SCRIPT_CHECKLIST.md). Prefer `SHEET_WEBHOOK_ID` over a full URL.

## Hosting options

| Option | Command / file |
|--------|----------------|
| VPS / any Docker host | `docker compose up -d --build` |
| Render | `render.yaml` (set secrets in dashboard) |
| Fly.io | `fly.toml` + `fly secrets set …` then `fly deploy` |
| Local smoke | `npm run product` → http://localhost:8787 |

Health: `GET /api/health`  
Readiness (config complete): `GET /api/ready`

## Iterate without changing the client habit

| Change | Action |
|--------|--------|
| Form / Seriti selectors | Edit `src/sections/*`, redeploy |
| Column headers | Client mapping file + restart if needed |
| New client | `npm run new-client …` |
| Pause client | `"enabled": false` in their JSON |
| Rotate client token | Re-run new-client with `--force` or edit secrets |
| Rotate webhook | New Apps Script deployment → `SHEET_WEBHOOK_ID` |

Client UI stays: open URL → token → **Run open rows**.

## Debug

- Sheet **Status** → `error CODE` (see README)
- Logs: `data/product/logs/<job-id>.log`
- `npm run readiness` / `npm run validate-sheet -- --client <id>`
- Operator Retry from UI, or CLI with that client’s `SHEET_ID`
