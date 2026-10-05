# What only Willem can do

I cannot log into GitHub secrets, Google Apps Script, or Cursor Automations from this agent. Everything in the repo is ready. Do these in order. Skip anything already done.

The Cursor always-on agent is **already Off**. Do not turn it back on. A click in GitHub (or the Sheet menu) now starts intake → Gemini → automation sheet → Seriti.

---

## 1. Confirm Cursor automation stays Off (30 seconds)

1. Open https://cursor.com/automations
2. Find **Hatfield intake to Melrose**
3. Leave it **Off**. Delete it if you prefer.

That 5-minute live agent was the token burn. Nothing in this PR starts it again.

---

## 2. GitHub Actions secrets (required — 2 minutes)

Open https://github.com/WillemAucamp/HatfieldAutomation/settings/secrets/actions

Create or fix these two repository secrets:

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | your Gemini key (same one already in Cursor secrets) |
| `SHEET_WEBHOOK_URL` | **only** the Apps Script URL, like `https://script.google.com/macros/s/…/exec` |

If `SHEET_WEBHOOK_URL` currently looks like `SHEET_WEBHOOK_URL=https://script.google.com/…`, edit it and delete the `SHEET_WEBHOOK_URL=` prefix. The url must start with `https://`.

---

## 3. First run from GitHub (required)

Until this PR is merged, pick branch **`cursor/full-chain-seriti-df0d`**. After merge, use **`main`**.

1. Open https://github.com/WillemAucamp/HatfieldAutomation/actions/workflows/intake-to-melrose.yml
2. Click **Run workflow** and choose:
   - Branch: this PR’s branch (or `main` after merge)
   - mode: **`full`**
   - maxIntakeRows: **`5`** (do not jump to 15 — Gemini is ~1 min/row when it needs web search)
   - dryRun: **unchecked**
3. Open the run. You should see **two jobs** in order:
   1. **Gemini ingest** — writes automation-sheet rows (Status still blank)
   2. **Seriti load** — starts automatically after ingest, writes `ZAHTVW…` into Status

If **Status** is `error …` after Seriti:

- `DROPDOWN_OPTION_MISSING: Bank/Account type/Province "…"` — change **that sheet column** to one of the listed Seriti names, clear Status, run **load-only**.
- `DROPDOWN_OPTION_MISSING` naming Industry/Occupation/Salesperson — not a sheet cell. Clear Status and re-run after this PR; the robot now picks a fallback menu item.
- `WORK_NEXT_FAILED` — **not** telephone or bank. Work & Salary Next did not open expenses (employment date, salary, or a required work field). Clear Status and re-run load-only.

Do **not** click `load-only` while `full` is still running. The two clicks share a queue; `load-only` will wait until ingest finishes, which is the delay you already hit.

`full` = Gemini, then Seriti for **every blank-Status** automation row (new plus leftovers).  
`ingest-only` = Gemini → automation sheet, no browser.  
`load-only` = Seriti only. Use this when ingest already finished and you need a retry.

A click never processes more than `maxIntakeRows` Form rows (default 5). Leftover Form rows stay unprocessed for the next click.

If Seriti fails in GitHub (blocked datacenter IP), ingest still worked. On your machine:

```bash
ROW_FILTER=N npm run dev
```

Replace `N` with the automation-sheet row number Gemini just wrote.

---

## 4. Optional — Hatfield menu on the Google Sheet

Only if you want **Hatfield → Process now** inside the spreadsheet instead of opening GitHub.

1. Open the spreadsheet that already has Apps Script (automation or intake sheet) → **Extensions → Apps Script**
2. Replace the code with `apps-script/Code.gs` from this branch
3. **Deploy → Manage deployments → pencil → Version: New version → Deploy**  
   Keep **Execute as: Me**, **Who has access: Anyone**
4. **Project Settings → Script properties** add:

   | Property | Value |
   | --- | --- |
   | `GITHUB_TOKEN` | a GitHub personal access token with **Actions: Read and write** on this repo |
   | `GITHUB_REPO` | `WillemAucamp/HatfieldAutomation` |
   | `GITHUB_REF` | `main` after merge; until then `cursor/full-chain-seriti-df0d` |
   | `MAX_INTAKE_ROWS` | `5` (optional) |

   Token: GitHub → Settings → Developer settings → Personal access tokens. Fine-grained: this repo, **Actions: Read and write**. Classic: `repo` + `workflow`.
5. Reload the spreadsheet. A **Hatfield** menu appears. Click **Process now**.

If the /exec URL changes when you redeploy, update GitHub secret `SHEET_WEBHOOK_URL` to the new URL.

---

## 5. Old Form rows sitting in intake (do this before a big `full` run)

Unprocessed intake rows still have a blank **Enrichment Status**. One `full` click will only take `maxIntakeRows` of them (default 5), but you probably do not want yesterday’s leftover Forms in Seriti.

Pick one:

- **Skip them:** in the sheet, Hatfield menu → **Mark old Form rows skipped…** (writes `skipped_historical` on blank Enrichment Status), **or**
- **Process in batches:** keep clicking Run with `maxIntakeRows=5` until the queue is empty.

---

## 6. What you do **not** need

- n8n
- Render / Fly / Docker host
- Cursor automations
- `setupIntakeWatch` in Apps Script
- Any always-on agent

Those files are still in the repo as leftovers. Ignore them.

---

## Local fallback (your laptop, no GitHub)

```bash
cp .env.example .env
# paste GEMINI_API_KEY and SHEET_WEBHOOK_URL

npm install
npm run install-browsers

MAX_INTAKE_ROWS=1 npm run ingest    # Gemini only
npm run process                     # Gemini then Seriti (blank Status too)
npm run dev                         # Seriti only, blank Status
```
