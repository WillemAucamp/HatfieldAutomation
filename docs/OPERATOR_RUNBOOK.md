# Operator runbook

## Add a client

1. Ask the client for (or create with them):
   - Applicant Google Sheet ID (and share link)
   - Optional loaded-clients / money sheet ID
2. Confirm sheet is readable as CSV (Anyone with link can view, or equivalent).
3. Deploy / attach Apps Script (`apps-script/Code.gs`) so write-back can edit their sheet(s).
4. `cp clients/_example.json clients/<slug>.json` — set `sheetId`, optional `loadedSheetId`, `displayName`.
5. Issue a token: add `slug:token` to `CLIENT_API_TOKENS` (or `clients/<slug>.secrets.json`).
6. Check headers against `mapping.json`. If they differ slightly, create `clients/<slug>.mapping.json` and point `mappingPath` at it.
7. Restart product process if env tokens changed. Client JSON is re-read from disk on each request.
8. Send them `docs/CLIENT_GUIDE.md` + URL + token (not the repo).

## Point at their sheets (never yours)

Production must not fall back to personal App Automation / money sheet IDs.  
`config.json` ships with empty sheet fields. Product jobs inject env from `clients/<id>.json` only.

## Update mapping

1. Edit `mapping.json` (global) or the client-specific mapping file.
2. Preview:  
   `SHEET_CSV_URL="https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=0" npm run preview`
3. No client UI change required.

## Redeploy code

1. Pull / merge changes.
2. `npm install` if deps changed.
3. `npm run install-browsers` if Playwright updated.
4. Restart `npm run product` (or container).
5. Clients keep the same URL and token.

## Pause / disable

Set `"enabled": false` in `clients/<id>.json`. Client sees the account but Run returns an error; operator can still trigger with `OPERATOR_TOKEN`.

## Retry yourself

- UI: operator login → select client → Retry row N  
- CLI: set that client’s `SHEET_ID` / webhook env → `npm run retry -- N`

## Rotate secrets

| Secret | Rotate |
|--------|--------|
| Client token | New value in `CLIENT_API_TOKENS` / secrets file; tell client |
| Operator token | New `OPERATOR_TOKEN` |
| Webhook | New Apps Script deployment → `SHEET_WEBHOOK_ID` |

## Failure patterns

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `error ID_NOT_13_DIGITS` | Sheet ID cell wrong | Fix cell, Retry |
| `error PERSONAL_NEXT_FAILED` | Validation on personal section | Check ID/mobile/email formats |
| `error DROPDOWN_OPTION_MISSING` | Bank / account type mismatch | Align sheet value to Seriti options |
| Job failed, Status blank | Webhook / credentials | Check `SHEET_WEBHOOK_ID`, Apps Script access |
| “A job is already queued” | Prior run still active | Wait; check `data/product/jobs` |
| Hollow CSV / missing IDs | gviz flake | Fetcher falls back to export automatically |

Logs: `data/product/logs/` and `runs/` for Playwright screenshots.
