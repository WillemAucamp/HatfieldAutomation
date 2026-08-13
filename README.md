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

CSV export URL (also in `config.json`):

```
https://docs.google.com/spreadsheets/d/12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI/export?format=csv&gid=0
```

Preview mapped rows without opening a browser:

```bash
npm run preview
```

### Google Sheet CSV URL

For a public sheet, use one of these formats:

```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={SHEET_NAME}
```

Ensure the sheet column headers match `mapping.json` (or update that file to match your headers).

### Run

```bash
# Dry-run: fills all sections, screenshots each step, stops before Section 5 Next click
npm run dry-run

# Live run (leaves browser open at Upload Documents for manual completion)
npm run dev

# Process specific rows only (1-based, comma-separated)
ROW_FILTER=2,3 npm run dev

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

Each sheet row is a **new browser context**. A failure or stop at Upload Documents closes that session and starts the next row from a blank slate. Pass `--keep-last-open` to leave only the final applicant's window open.

## Configuration

Environment variables (`.env`):

| Variable | Default | Description |
|---|---|---|
| `SHEET_CSV_URL` | live applicant sheet | Public Google Sheet CSV export URL |
| `MAPPING_PATH` | `./mapping.json` | Column mapping file |
| `DRY_RUN` | `false` | Fill only, no navigation past Section 5 |
| `STRICT_MODE` | `false` | Abort that applicant on field lookup/verify failure |
| `HEADLESS` | `false` | Run browser headlessly |
| `ROW_FILTER` | — | Comma-separated 1-based row numbers |
| `SKIP_PROCESSED` | `false` | Skip IDs already in `processed-rows.json` |
| `KEEP_LAST_OPEN` | `false` | Leave the last headed session open |
| `ACTION_DELAY_MIN` | `200` | Min ms delay between actions |
| `ACTION_DELAY_MAX` | `800` | Max ms delay between actions |

CLI flags: `--dry-run`, `--strict`, `--no-strict`, `--skip-processed`, `--keep-last-open`, `--local-csv=path.csv`

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

By default **every sheet row is processed**. To skip IDs already completed, pass `--skip-processed` or set `SKIP_PROCESSED=true`. Completed IDs are recorded in `processed-rows.json`.

## Data compensation

Sheet values that do not match form expectations are rewritten so the run can continue. Compensations are logged on the applicant and in `run-log.json` — they never skip the row.

| Field | Rule |
|---|---|
| ID number | RSA IDs are 13 digits. Shorter values are left-padded with zeros and given a valid checksum (e.g. `8225878084` → `0008225878083`) |
| Mobile / employer / kin phone | Strip `+27`/`27`, prepend `0` for 9-digit values, pad/trim to 10 digits; empty → `0600000000` |
| Combined names | Split on the last space; single-token names get surname `Unknown` |
| Dates | Accept `MM DD YYYY`, slashes/dashes, ISO, Excel serials; unparseable → `01 01 2020` |
| Empty text | Placeholder (`Address not provided`, `Unknown Employer`, synthesized email) |
| Empty amounts | `0` |
| Postal code | Type value, then select first dropdown match |
| Province | Always `Gauteng` |

## Resuming a session

After a live run stops at Upload Documents, `storage-state.json` is saved in the applicant folder. Load it in a custom script or Playwright codegen session to resume where automation left off.

## Development

```bash
npm run build     # compile TypeScript to dist/
npm start         # run compiled dist/runBatch.js
```

Sections can be tested independently by importing their `runSectionN` function and calling it against a live page with a prepared `FillContext`.
