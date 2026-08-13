/**
 * One webhook for both Google Sheets.
 *
 * 1. Open EITHER spreadsheet → Extensions → Apps Script
 * 2. Paste this file
 * 3. Deploy → New deployment → Web app
 *      Execute as: Me
 *      Who has access: Anyone
 * 4. Put the /exec URL in .env as SHEET_WEBHOOK_URL
 *
 * Actions
 *   appendLoaded — add/update Name + cellphone on the loaded-clients sheet
 *   writeStatus  — write Status + Timing on the applicant source sheet
 *
 * The account that deploys this must be able to edit both spreadsheets.
 */

var SOURCE_SHEET_ID = "12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI";
var LOADED_SHEET_ID = "1V8re1qmdC0AXyDKt9G3gQxcqmn3q9hAJeM_YpUkjRLM";

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var action = data.action || inferAction_(data);

  try {
    if (action === "appendLoaded") {
      return json_(appendLoaded_(data));
    }
    if (action === "writeStatus") {
      return json_(writeStatus_(data));
    }
    return json_({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function inferAction_(data) {
  if (data.name && (data.number || data.mobile || data.referenceNumber) && data.action !== "writeStatus") {
    return "appendLoaded";
  }
  return "writeStatus";
}

function writePhone_(sheet, row, col, value) {
  sheet.getRange(row, col).setNumberFormat("@").setValue(String(value));
}

function appendLoaded_(data) {
  var ss = SpreadsheetApp.openById(data.loadedSheetId || LOADED_SHEET_ID);
  var sheet = ss.getSheets()[0];
  var nameColumn = data.nameColumn || "Name";
  var numberColumn = data.numberColumn || "Number";
  var headers = ensureHeaders_(sheet, [nameColumn, numberColumn]);
  var nameCol = headers.indexOf(nameColumn) + 1;
  var numberCol = headers.indexOf(numberColumn) + 1;

  var name = String(data.name || "").trim();
  var number = String(data.number || data.mobile || "").trim();
  if (!name || !number) {
    return { ok: false, error: "name and number are required" };
  }

  var last = Math.max(sheet.getLastRow(), 1);
  if (last >= 2) {
    var names = sheet.getRange(2, nameCol, last - 1, 1).getValues();
    var numbers = sheet.getRange(2, numberCol, last - 1, 1).getValues();
    var updated = 0;
    var lastRow = 0;
    for (var i = 0; i < names.length; i++) {
      if (String(names[i][0]).trim().toLowerCase() !== name.toLowerCase()) continue;
      lastRow = i + 2;
      if (String(numbers[i][0]).trim() === number) {
        updated++;
        continue;
      }
      writePhone_(sheet, lastRow, numberCol, number);
      updated++;
    }
    if (updated > 0) {
      return { ok: true, updated: true, row: lastRow, name: name, number: number, count: updated };
    }
    for (var j = 0; j < numbers.length; j++) {
      if (String(numbers[j][0]).trim() === number) {
        return { ok: true, skipped: true, row: j + 2, number: number };
      }
    }
  }

  var row = last + 1;
  if (last === 1 && !sheet.getRange(1, nameCol).getValue()) {
    row = 2;
  }
  sheet.getRange(row, nameCol).setValue(name);
  writePhone_(sheet, row, numberCol, number);
  return { ok: true, row: row, name: name, number: number };
}

function writeStatus_(data) {
  var ss = SpreadsheetApp.openById(data.sourceSheetId || SOURCE_SHEET_ID);
  var sheet = ss.getSheets()[0];
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];

  var statusColumn = data.statusColumn || data.referenceColumn || "Status";
  var timingColumn = data.timingColumn || "Timing";
  var statusCol = ensureColumn_(sheet, headers, statusColumn);
  var timingCol = ensureColumn_(sheet, headers, timingColumn);
  var statusValue = data.status != null ? data.status : data.referenceNumber;

  var row = Number(data.rowIndex) || 0;
  if (!row && data.email) {
    var emailCol = headers.indexOf(data.emailColumn || "Email") + 1;
    if (emailCol > 0 && sheet.getLastRow() > 1) {
      var emails = sheet.getRange(2, emailCol, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < emails.length; i++) {
        if (String(emails[i][0]).trim() === String(data.email).trim()) {
          row = i + 2;
          break;
        }
      }
    }
  }

  if (!row) {
    return { ok: false, error: "Could not match source sheet row" };
  }

  if (statusValue !== undefined && statusValue !== null) {
    sheet.getRange(row, statusCol).setValue(statusValue);
  }
  if (data.timingSeconds !== undefined && data.timingSeconds !== null && data.timingSeconds !== "") {
    sheet.getRange(row, timingCol).setValue(Number(data.timingSeconds));
  }

  return { ok: true, row: row, status: statusValue, timingSeconds: data.timingSeconds };
}

function ensureHeaders_(sheet, names) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < names.length; i++) {
    ensureColumn_(sheet, headers, names[i]);
  }
  return headers;
}

function ensureColumn_(sheet, headers, name) {
  var col = headers.indexOf(name) + 1;
  if (col === 0) {
    col = headers.length + 1;
    sheet.getRange(1, col).setValue(name);
    headers[col - 1] = name;
  }
  return col;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
