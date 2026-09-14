# How to load applicants (client one-pager)

You use **your** Google Sheet. You do not need GitHub, a terminal, or any passwords except the access token we send you.

## 1. Your sheet

1. Keep using your applicant spreadsheet (the one we connected).
2. Fill a row with applicant details.
3. Leave **Status** empty for rows that should be loaded.
4. Do not edit **Timing** — the system fills it.

Optional: if we connected a loaded-clients sheet, successful loads append **Name** + **Number** there.

## 2. Open the runner

1. Open the link we sent you (for example `https://your-runner.example.com`).
2. Paste your **access token**.
3. Click **Continue**.

Keep the token private. Ask us if you need it rotated.

## 3. Run open rows

1. Click **Run open rows**.
2. Wait until the run shows **success** or **failed** on the page.
3. Refresh your Google Sheet:
   - Success → **Status** starts with `ZAHTVW…`
   - Problem → **Status** looks like `error …` (fix the cell or tell us)

Empty Status rows are processed; rows that already have Status are skipped.

## 4. Retry one row

If a row failed:

1. Enter the sheet row number (row **2** is the first data row).
2. Click **Retry row**.

That clears Status for that row and loads it again.

## 5. What you should not do

- Do not ask for the code repository or server passwords.
- Do not paste webhook URLs or API keys into the sheet.
- Do not clear a successful `ZAHTVW…` Status unless you intentionally want that person loaded again.

## Need help?

Send us: the row number, the **Status** text, and a screenshot of the row. We can fix mapping or form issues on our side without changing how you click **Run**.
