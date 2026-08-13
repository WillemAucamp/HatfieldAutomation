/**
 * Paste this into Extensions → Apps Script on the applicant Google Sheet,
 * then Deploy → New deployment → Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Copy the web app URL into .env as SHEET_WEBHOOK_URL
 */

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const referenceColumn = data.referenceColumn || "Reference Number";
  let refCol = headers.indexOf(referenceColumn) + 1;
  if (refCol === 0) {
    refCol = headers.length + 1;
    sheet.getRange(1, refCol).setValue(referenceColumn);
  }

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

  sheet.getRange(row, refCol).setValue(data.referenceNumber);
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, row: row, referenceNumber: data.referenceNumber })
  ).setMimeType(ContentService.MimeType.JSON);
}
