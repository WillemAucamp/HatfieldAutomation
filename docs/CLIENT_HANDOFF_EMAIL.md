# Client handoff email (template)

Fill the blanks after `npm run new-client` (it also writes `clients/<id>.handoff.txt`).

---

**Subject:** Your finance load runner is ready

Hi,

Your load runner is ready. You do not need GitHub or a terminal.

1. Keep using **your** Google Sheet. Leave **Status** blank on rows you want loaded.
2. Open: `{{PRODUCT_PUBLIC_URL}}`
3. Paste this access token:

```
{{CLIENT_TOKEN}}
```

4. Click **Continue**, then **Run open rows**.
5. Refresh the sheet — **Status** shows `ZAHTVW…` on success, or `error …` if a row needs a fix.

To retry one failed row, enter the sheet row number (row 2 = first data row) and click **Retry row**.

Keep the token private. Reply if you need it rotated.

Thanks  
Willem

---

Attach or link: `docs/CLIENT_GUIDE.md` (optional; the email is enough for most clients).
