# AGENTS.md — Hatfield / VW Melrose finance autofill

Read this first every session. Operator setup and click-by-click steps: [README.md](./README.md), [config/YOU_DO.md](./config/YOU_DO.md). Do not duplicate them here.

## Business purpose

Salespeople capture client vehicle-finance applications via a Google Form. This repo formats those answers and loads them into the Seriti finance site (`financeUrl` in `config.json`) with Playwright so finance staff can process compliant applications. Finance compliance is strict.

## Hard rules (non-negotiable)

1. An application that fails Seriti/data standards must **never** be loaded. Write a clear Status error so it can be fixed and reloaded.
2. Never invent or guess client data. Missing or unclear data → flag for salesperson follow-up. (Gemini may still infer employer contact from employer name + location — see Known issue B; do not widen that behaviour.)
3. Never copy personal details (name, home address, mobile) into employer fields.
4. Client data is personal information (SA ID, phones, salaries). Never put real client data in code, tests, logs, commits, or this file. Fake data only.
5. Never click Finish / submit to Seriti, or write to live Google Sheets, unless the current task explicitly asks.

## Pipeline

1. **Intake** — Form responses land on the intake sheet. Processed rows are marked in **Enrichment Status** (`markIntakeStatus` in `src/intake/ingest.ts`; default column from `loadConfig()` in `src/config.ts`).
2. **Formatting** — Gemini fills only `mode: infer` columns (`buildSystemPrompt` in `src/intake/prompt.ts`, `config/intake-mapping.yaml`). Copy columns and fixes: `buildOutputValues` / `applyDeterministicFixes` in `src/intake/row.ts`.
3. **Output** — One **38-column** row is appended to the automation sheet (`destination.column_count` in the yaml). **Status** and **Timing** start empty.
4. **Validation** — `mapRow` in `src/fetchSheetData.ts` checks ~30 required fields and attaches coded errors. In `processApplicant` (`src/runBatch.ts`), rows with errors are **not** filled; Status becomes `error <CODES>` via `formatErrorCell` (`src/outcome.ts`). Rows whose Status is already filled are skipped (`isStatusPopulated`). `npm run retry` → `src/retryRows.ts` clears Status/Timing then live-runs.
5. **Load** — Playwright fills the Seriti form inside an iframe (`waitForFormFrame` / `FORM_FRAME_PATTERN` in `src/formUtils.ts`; sections `src/sections/section1.ts`–`section6.ts`; `src/fieldResolver.ts`). On success, the application reference is written to Status.
6. **Trigger** — GitHub Actions workflow **Intake to Melrose** (manual `workflow_dispatch`, `MAX_INTAKE_ROWS` default **5**). Optional Sheet menu: `apps-script/Code.gs`. n8n, Render, and `trigger-server` are leftovers and not required. Keep the Cursor automation **Hatfield intake to Melrose** **OFF** ([config/cursor-automation.md](./config/cursor-automation.md)).

## Commands

**SAFE** (no Seriti submit; no intentional live sheet writes):

| Command | Notes |
|---|---|
| `npm test` | `tsx --test` suite next to the code |
| `npm run preview` | Reads sheet/CSV; stdout only |
| `npm run doctor` | Connectivity / config probes; no sheet writes |
| `npm run enrich-sample` | Gemini sample only; not written to sheets |

**FORBIDDEN** unless the current task explicitly asks (live Seriti and/or sheet writes):

`npm run dev`, `start`, `process`, `watch`, `ingest`, `retry`, `sheet-update`, `sync-loaded`, `notify-leads`, `renumber-rows`, `trigger-server`, and any Finish/submit or live-sheet write.

**`npm run dry-run`:** Opens the **live** Seriti URL and fills sections 1–5; does **not** click Finish. Still may call `renumberSheetRows` on the live automation sheet when webhook/credentials exist. Data-error rows still write Status via `persistOutcome`. `--local-csv` only changes the data source — it still hits live Seriti. Treat as live-touching unless Willem explicitly asks.

## Known issues (document only — do not fix here)

A. **Street overwrite** — `syncAddressFromPostal` (`src/formUtils.ts`) returns the suburb from Seriti postal autocomplete as Address line 1 (used in `section3.ts` / `section4.ts`), overwriting the street. May relate to Seriti suburb validation / `normalizeAddressLine` in `src/transforms.ts` (unconfirmed).
B. **Employer gap-filling** — Prompt allows inferring employer phone, address, postal, province from employer + location (model memory, not search). Validation requires those four non-empty. Nothing tracks client-sourced vs inferred.
C. **No self-employed path** — No self-employed handling in code. Form now has that option; unverifiable employment that is not self-employed must error for follow-up.
D. **Terse validation Status** — Data failures write `error CODE[, CODE…]` only. Needed: per-failure rule, field, raw/expected value, owner (salesperson vs automation). Runtime failures may add a short human hint via `formatRuntimeErrorCell`.
E. **Hardcoded Seriti answers** — Some fields use identical answers for every client (e.g. declaration radios, salesperson select in `section1.ts`). Per-client values may already exist on the output sheet but are not mapped into Seriti.

## Planned work (NOT STARTED)

- Round-robin allocation of each application to a salesperson and a finance specialist; load according to that allocation; per-application email with both CC'd.
- Extend validation in `fetchSheetData.ts` / `outcome.ts` into one compliance gate driven by a rules list — do not build a parallel gate.

## Working rules for agents

- One task per session. Touch only files named in the task. No drive-by refactors or renames.
- Failing test first, then fix. Run `npm test` before finishing. Match existing style (`tsx --test`, tests beside code).
- If Willem says “investigate first”, report before changing anything.
- If ambiguous, ask. Do not guess.
- Keep diffs small. Commit per task.
- Never print or copy values from `.env` or other secrets.
