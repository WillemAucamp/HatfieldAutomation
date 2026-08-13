/**
 * Paste this into Extensions → Apps Script on the applicant Google Sheet,
 * then Deploy → New deployment → Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Copy the web app URL into .env as SHEET_WEBHOOK_URL
 *
 * Writes:
 *   Status — ZAHTVW… on success, or `error CODE` on failure
 *   Timing — seconds spent on that row (numeric, so AVERAGE() works)
 */

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];

  const statusColumn = data.statusColumn || data.referenceColumn || "Status";
  const timingColumn = data.timingColumn || "Timing";
  const statusCol = ensureColumn_(sheet, headers, statusColumn);
  const timingCol = ensureColumn_(sheet, headers, timingColumn);
  const statusValue = data.status != null ? data.status : data.referenceNumber;

  let row = Number(data.rowIndex) || 0;
  if (!row && data.email) {
    const emailCol = headers.indexOf(data.emailColumn || "Email") + 1;
    if (emailCol > 0) {
      const emails = sheet.getRange(2, emailCol, sheet.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < emails.length; i++) {
        if (String(emails[i][0]).trim() === String(data.email).trim()) {
          row = i + 2;
          break;
        }
      }
    }
  }

  if (!row) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: "Could not match sheet row" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (statusValue !== undefined && statusValue !== null) {
    sheet.getRange(row, statusCol).setValue(statusValue);
  }
  if (data.timingSeconds !== undefined && data.timingSeconds !== null && data.timingSeconds !== "") {
    sheet.getRange(row, timingCol).setValue(Number(data.timingSeconds));
  }

  return ContentService.createTextOutput(
    JSON.stringify({
      ok: true,
      row: row,
      status: statusValue,
      timingSeconds: data.timingSeconds,
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

function ensureColumn_(sheet, headers, name) {
  let col = headers.indexOf(name) + 1;
  if (col === 0) {
    col = headers.length + 1;
    sheet.getRange(1, col).setValue(name);
    headers[col - 1] = name;
  }
  return col;
}
