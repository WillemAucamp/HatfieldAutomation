# Cursor Automation — paste into the Untitled Settings screen

Create this once at https://cursor.com/automations → New Automation.
This file is the exact config. Do not invent extra steps.

## Settings

| Field | Value |
| --- | --- |
| Name | Hatfield intake to Melrose |
| Repository | WillemAucamp/HatfieldAutomation |
| Branch | cursor/intake-llm-watch-43d2 |
| Model | cursor-grok-4.6-high-fast |
| Status | Save first, then toggle **Active** |

## Triggers

1. **Scheduled** — every 5 minutes (`*/5 * * * *`)
2. Optional after Save: **Webhook** — copy the URL + API key into Apps Script script properties:
   - `CURSOR_WEBHOOK_URL`
   - `CURSOR_WEBHOOK_API_KEY`
   Then in Apps Script run `setupIntakeWatch` once.

## Tools

- Keep **Memories**
- Do **not** add extra MCP
- Turn **off** pull-request creation if it is enabled
- Computer use stays on (Melrose browser)

## Agent instructions (paste all of this)

You are the 24/7 Hatfield finance loader. Do not change code. Do not open a pull request. Do not invent client data. Do not commit secrets.

Repo: WillemAucamp/HatfieldAutomation
Branch: cursor/intake-llm-watch-43d2

Each run:
1. Confirm GEMINI_API_KEY and SHEET_WEBHOOK_URL are present as environment secrets. If either is missing, stop and report the name. Do not print secret values.
2. npm ci
3. npx playwright install chromium
4. npm run doctor
5. If doctor says the Apps Script deploy is old (Unknown action: readSheet, or version is not hatfield-intake-1), STOP and report that. Do not guess sheet data.
6. If doctor is green, run: npm run watch -- --once
   That reads new Google Form rows, sends each to Gemini with the standing prompt (fresh call), appends one 35-column row to the automation sheet with Status and Timing blank, then runs the existing Melrose Playwright loader on those new rows only.
7. Reply with: intake rows scanned, appended sheet row numbers, skipped, errors, and any ZAHTVW references written to Status.

If there are no new Form rows, say so and do nothing else.
