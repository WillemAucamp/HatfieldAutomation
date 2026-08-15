# VW Melrose Finance Application Auto-Filler

Browser automation that reads applicant data from a public Google Sheet and fills the [VW Melrose finance application](https://vwmelrose.hatfieldgroup.co.za/finance) through Section 5, stopping before document upload for manual completion.

## Stack

- **Node.js + TypeScript**
- **Playwright** for browser automation
- **papaparse** for CSV parsing
- **fuse.js** for fuzzy label matching

## Quick start

```bash
npm install
npm run install-browsers   # downloads Chromium for Playwright

cp .env.example .env
# SHEET_CSV_URL already points at the live applicant sheet
```

The default data source is this public Google Sheet:

https://docs.google.com/spreadsheets/d/12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI/edit?usp=sharing

CSV URL (gviz; also in `config.json` — `/export` often 502s, and the fetcher retries/falls back):

```
https://docs.google.com/spreadsheets/d/12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI/gviz/tq?tqx=out:csv&gid=0
```

Preview mapped rows without opening a browser:

```bash
npm run preview
```

### Google Sheet CSV URL

For a public sheet, use one of these formats:

```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid={GID}
https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}
```

Prefer **gviz**. `fetchSheetCsv` retries on 502/503 and falls back between gviz and export.

Ensure the sheet column headers match `mapping.json` (or update that file to match your headers).

### Run

```bash
# Dry-run: fills sections 1–5, screenshots each step, does not click Finish
npm run dry-run

# Live run: fills the form, clicks Finish, captures the reference, writes it to the sheet
npm run dev

# Process specific rows only (1-based, comma-separated)
ROW_FILTER=2,3 npm run dev

# Retry rows that already have Status (clears Status, then live-runs)
npm run retry -- 18
npm run retry -- 12 15

# Headless mode
HEADLESS=true npm run dev

# Local CSV instead of remote sheet (useful for testing)
npm run dev -- --local-csv=./sample-data.csv
```

## Project structure

| File | Purpose |
|---|---|
| `src/fetchSheetData.ts` | Fetches and parses public sheet CSV into typed applicant records |
| `src/fieldResolver.ts` | Resilient field lookup (label → role → placeholder → fieldset → fuzzy) |
| `src/transforms.ts` | Mobile zero-pad and date format validation |
| `src/sections/section1.ts` … `section5.ts` | One module per form section |
| `src/runBatch.ts` | Batch orchestrator |
| `mapping.json` | Sheet column header → field role mapping |

## Field discovery

The finance form loads inside an **iframe** (`torque.seritisolutions.co.za`). The automation detects and switches to this frame automatically after clicking "Apply for Finance".

Fields are located using strategies in priority order:

1. **ARIA role** — `getByRole('textbox', { name: /first name/i })`
2. **Associated label** — match label text, resolve `for` attribute or nested input
3. **Placeholder text**
4. **Fieldset / section legend**
5. **Fuzzy match** — Levenshtein via fuse.js against visible labels
6. **Semantic name/id** — stable `name`/`id` attributes (e.g. `emailAddress`, `txtClientFirstName`) as a last resort

Every fill is followed by read-back verification. In strict mode, mismatches abort that applicant's run (the batch still continues with the next row). Default is non-strict: log a warning and keep filling.

Each sheet row is a **new browser context**. After submit **or** a failure that session closes, the outcome is written to the sheet, and the next row starts clean. Pass `--keep-last-open` to leave only the final applicant's window open.

## Configuration

Environment variables (`.env`):

| Variable | Default | Description |
|---|---|---|
| `SHEET_CSV_URL` | live applicant sheet (gviz) | Public Google Sheet CSV URL (gviz preferred) |
| `MAPPING_PATH` | `./mapping.json` | Column mapping file |
| `DRY_RUN` | `false` | Fill only, no navigation past Section 5 |
| `STRICT_MODE` | `false` | Abort that applicant on field lookup/verify failure |
| `HEADLESS` | `false` | Run browser headlessly |
| `ROW_FILTER` | — | Comma-separated 1-based row numbers |
| `SKIP_PROCESSED` | `false` | Skip IDs already in `processed-rows.json` |
| `KEEP_LAST_OPEN` | `false` | Leave the last headed session open |
| `SHEET_WEBHOOK_URL` | — | Apps Script web app URL (writes source Status and loaded Name/Number) |
| `LOADED_SHEET_ID` | loaded-clients sheet | Spreadsheet that receives Name + cellphone after each successful load |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | — | Service account JSON for Sheets API write-back |
| `ACTION_DELAY_MIN` | `0` | Min ms delay between actions |
| `ACTION_DELAY_MAX` | `0` | Max ms delay between actions |
| `SCREENSHOTS` | dry-run only | Save before/after step screenshots |
| `VERIFY_FILLS` | `false` | Read back every field after fill |

CLI flags: `--dry-run`, `--strict`, `--no-strict`, `--skip-processed`, `--keep-last-open`, `--screenshots`, `--verify`, `--local-csv=path.csv`

Retry helper: `npm run retry -- <row> [row...]` clears **Status** via the Apps Script webhook, drops matching local outcome records, then runs `dev` for those rows only.

## Pointing at a different sheet

1. Update `SHEET_CSV_URL` in `.env` or `config.json`.
2. Edit `mapping.json` so each field role maps to your sheet's column headers.
   Combined columns such as `First names + surname` are split on the last space.
3. Ensure date columns contain pre-formatted `MM DD YYYY` strings (e.g. `08 12 2013`).
4. Format mobile numbers as text in the sheet, or rely on the zero-pad transform for 9-digit values.

## Run logs and screenshots

Each batch creates a timestamped folder under `runs/`:

```
runs/2026-08-12T07-30-00-000Z/
  run-log.json          # structured batch log
  run-log.csv           # summary CSV
  row-2-John_Doe/
    section-section1-before.png
    section-section1-after.png
    ...
    storage-state.json  # resumable Playwright session (live runs only)
```

### When a field lookup fails

1. Check `run-log.json` for the `warnings` array — field name, section, message.
2. Open the `missing-{field}.png` or section screenshots in the applicant folder.
3. Compare label text on the live form against the `labels` / `synonyms` in the section module.
4. Re-run with `--dry-run` and `ROW_FILTER` set to a single row.

## Duplicate-run guard

A row whose **Status** cell already has any value (`ZAHTVW…` or `error CODE`) is skipped entirely. Only rows with a blank Status are submitted. Clear Status if you want that row tried again.

A local `ZAHTVW…` in `application-references.json` is also skipped, so a successful submit is not repeated if the sheet has not been updated yet.

## Submit and write the result back

After Section 5 the live run:

1. Opens **Upload Documents** (no files are uploaded — documents stay optional).
2. Clicks **FINISH**.
3. Reads the success popup (`Your Reference Number is : ZAHTVW…`).
4. Clicks **OK**.
5. Writes the outcome:
   - Applicant sheet **Status** — `ZAHTVW…` on success, or `error CODE` on failure; **Timing** — seconds.
   - Loaded-clients sheet **Name** + **Number** — applicant name and cellphone (successes only).

If a row fails (bad sheet data or a form error), the batch **does not stop**. It writes `error …` plus timing on the applicant sheet, skips the loaded-clients row, closes the session, and continues.

Dry-run still stops before Finish and does not write either sheet.

### Enable Google Sheet write-back

CSV export is read-only. One Apps Script webhook can edit **both** spreadsheets (you must be able to edit both):

1. Open [the loaded-clients sheet](https://docs.google.com/spreadsheets/d/1V8re1qmdC0AXyDKt9G3gQxcqmn3q9hAJeM_YpUkjRLM/edit) (or the applicant sheet) → Extensions → Apps Script.
2. Paste `apps-script/Code.gs`.
3. Deploy → New deployment → Web app. Execute as *Me*, access *Anyone*.
4. Put the web app URL in `.env`:

```
SHEET_WEBHOOK_URL=https://script.google.com/macros/s/…/exec
```

Push already-captured outcomes with `npm run sync-loaded` (writes Status/Timing and upserts Name + cellphone). Use `npx tsx src/syncLoadedSheet.ts --loaded-only` to update only the money sheet.

**Option B — Google service account:** share **both** sheets with the account as Editor and set `GOOGLE_SERVICE_ACCOUNT_FILE`.

Until that URL is set, outcomes stay in `application-references.json`.

## Resuming a session

`storage-state.json` is saved per applicant after submit (or dry-run) in the run folder.

## Data errors (human error in the sheet)

The website rejects values that do not match its format. The script therefore **does not invent or pad invalid data**. It writes `error CODE` into **Status**, writes seconds into **Timing**, and continues with the next row in a new session.

The only automatic rewrite is the known Google Sheets artefact: a 9-digit mobile with no leading `0` gets `"0"` prepended.

| Code | Meaning |
|---|---|
| `ID_NOT_13_DIGITS` | RSA ID is not exactly 13 digits |
| `ID_EMPTY` | ID number cell is empty |
| `MOBILE_NOT_10_DIGITS` | Mobile is not 10 digits starting with 0 (after optional leading-0 restore) |
| `MOBILE_EMPTY` | Mobile number is empty |
| `EMAIL_EMPTY` / `EMAIL_INVALID` | Missing or malformed email |
| `NAME_EMPTY` / `NAME_MISSING_SURNAME` | Applicant name missing or not "First Last" |
| `NEXT_OF_KIN_EMPTY` / `NEXT_OF_KIN_MISSING_SURNAME` | Next of kin name missing or incomplete |
| `RESIDENCY_DATE_FORMAT` / `EMPLOYMENT_DATE_FORMAT` | Date is not `MM DD YYYY` |
| `ACCOUNT_HOLDER_EMPTY` | Account holder is empty |
| `BANK_EMPTY` | Bank name cell is empty |
| `ACCOUNT_TYPE_EMPTY` | Account type cell is empty |
| `PERSONAL_NEXT_FAILED` | Next did not leave Personal Information |
| `WORK_NEXT_FAILED` | Next did not leave Work & Salary |
| `FINANCIAL_NEXT_FAILED` | Next did not reach Upload Documents |
| `DROPDOWN_OPTION_MISSING` | Bank/account type (or other select) had no matching option — fails immediately |
| `FINISH_NO_REFERENCE` | Finish clicked but no `ZAHTVW` popup |
| `FORM_IFRAME_TIMEOUT` | Finance iframe did not load |
| `SUBMIT_FAILED` | Unclassified runtime failure |

Fix the sheet cell, then clear **Status** and re-run (`npm run retry -- <row>`). Error codes are written to **Status** as `error ID_NOT_13_DIGITS`, and also stored in `run-log.json` / `run-log.csv`.

Postal code: type the sheet value (and town from the address if needed), then select the first dropdown match. **Province** comes from the sheet. **Bank** and **Account type** come from the sheet (`Bank name`, `Account type`); nicknames such as FNB / Standardbank are matched to the live dropdown.

## Development

```bash
npm run build     # compile TypeScript to dist/
npm start         # run compiled dist/runBatch.js
```

Sections can be tested independently by importing their `runSectionN` function and calling it against a live page with a prepared `FillContext`.
