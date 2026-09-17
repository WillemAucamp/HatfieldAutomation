# Apps Script checklist (operator)

Do this once per Google account that will write to client sheets  
(or once per client if each has a separate deployment).

## Before you start

- [ ] You can open the **client’s** applicant Google Sheet as Editor  
- [ ] Optional loaded-clients / money sheet: you are Editor there too  
- [ ] Sheet is readable as CSV for the runner (Anyone with the link can view, or equivalent)

## Deploy

1. [ ] Open the client applicant sheet (or loaded sheet)  
2. [ ] **Extensions → Apps Script**  
3. [ ] Delete any stub code; paste contents of `apps-script/Code.gs`  
4. [ ] Leave `SOURCE_SHEET_ID` / `LOADED_SHEET_ID` empty unless this deploy is dedicated to one client  
5. [ ] **Deploy → New deployment → Web app**  
   - Execute as: **Me**  
   - Who has access: **Anyone**  
6. [ ] Authorize Google permissions when prompted  
7. [ ] Copy the deployment URL; take the middle id:

```
https://script.google.com/macros/s/AKfycb………/exec
                                 ^^^^^^^^^^^^^^^^
                                 SHEET_WEBHOOK_ID
```

8. [ ] Put that id in server `.env` as `SHEET_WEBHOOK_ID=…`  
   (prefer id over full URL — survives secret redaction)

## Prove write-back

```bash
# After product env is set:
npm run validate-sheet -- --client <id>
# Then operator login → Retry a test row, or run CLI against that sheet
```

- [ ] A test row gets Status / Timing written  
- [ ] Optional: successful load appends Name + Number on loaded sheet  

## Security

- [ ] Client never receives `SHEET_WEBHOOK_ID` or the full `/exec` URL  
- [ ] Client only gets product URL + their API token  
