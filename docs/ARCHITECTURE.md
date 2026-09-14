# Architecture — sheet → Seriti → write-back product

## Goal

Clients trigger the existing VW Melrose / Seriti finance autofill against **their own** Google Sheets, without repo or secret access. You (operator) keep code, mapping, deploys, and webhook credentials.

## Pieces

```
Client Google Sheets          Product UI (token auth)         Operator infra
─────────────────────         ───────────────────────         ──────────────
Applicant sheet               “Run open rows”                 Playwright runner
  empty Status = to load      “Retry row N”                   mapping.json
  Status / Timing write-back  job status                      SHEET_WEBHOOK_ID
Optional loaded-clients         │                             clients/*.json
  Name + Number                 ▼
                            Job queue (serial)
                                │
                                ▼
                     runBatch / retryRows
                     (same Seriti iframe flow)
                                │
                                ▼
                     Apps Script webhook write-back
                     → client’s sheets only
```

## Auth

| Role | How | What they can do |
|------|-----|------------------|
| **Client** | Long API token (`CLIENT_API_TOKENS` or `clients/<id>.secrets.json`) | Run / retry **only** their configured sheets; see their job history |
| **Operator** | `OPERATOR_TOKEN` | Pick any client, trigger runs, see all jobs; full server/logs/secrets |

Clients never receive GitHub, `.env`, webhook URLs, or Playwright credentials.

## Per-client config

File: `clients/<id>.json`

- `sheetId` — applicant / App Automation sheet (required)
- `loadedSheetId` — optional money / loaded-clients sheet
- `mappingPath` — default `./mapping.json`, or a client-specific override
- `financeUrl` — defaults to VW Melrose; override only if needed later
- `enabled` — set `false` to pause client triggers

Tokens are **not** stored in the committed JSON. Use env:

```
CLIENT_API_TOKENS=acme:longtoken,other:longtoken2
OPERATOR_TOKEN=your-operator-token
SHEET_WEBHOOK_ID=apps-script-deployment-id
```

Prefer `SHEET_WEBHOOK_ID` over pasting a full webhook URL into secrets (avoids redaction issues).

## Same Seriti site

The runner always opens `financeUrl` (default `https://vwmelrose.hatfieldgroup.co.za/finance`) and fills the Seriti iframe sections 1→6 exactly as the CLI `npm run dev` / `npm run retry` path does.

## Sheet semantics (unchanged)

- Empty **Status** → eligible to load
- Success → `ZAHTVW…` in Status, seconds in Timing; optional Name/Number on loaded sheet
- Failure → `error CODE` in Status + Timing; clear Status or use Retry

## Out of scope (v1)

- 24/7 schedules (manual trigger only)
- Forcing clients onto operator personal sheets
- Replacing Google Sheets as the business UI
