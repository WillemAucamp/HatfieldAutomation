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
 *   appendLoaded  — add/update Name + cellphone on the loaded-clients sheet
 *   writeStatus   — write Status + Timing on the applicant source sheet
 *   renumberRows  — fill column A with 1, 2, 3… (row 2 = 1; row 1 = header)
 *   updateSheet   — arbitrary cell updates on any spreadsheet/tab
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
    if (action === "renumberRows") {
      return json_(renumberRows_(data));
    }
    if (action === "updateSheet") {
      return json_(updateSheet_(data));
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

function renumberRows_(data) {
  var ss = SpreadsheetApp.openById(data.sourceSheetId || SOURCE_SHEET_ID);
  var sheet = ss.getSheets()[0];
  var nrColumn = data.nrColumn || "NR";
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var nrCol = ensureColumn_(sheet, headers, nrColumn);
  if (nrCol !== 1) {
    return { ok: false, error: "NR column must be column A (found column " + nrCol + ")" };
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, count: 0, message: "No data rows to number" };
  }

  var count = lastRow - 1;
  var values = [];
  for (var i = 1; i <= count; i++) {
    values.push([i]);
  }
  sheet.getRange(2, 1, lastRow, 1).setValues(values);
  return { ok: true, count: count, firstRow: 2, lastRow: lastRow };
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

/**
 * Arbitrary sheet edits.
 *
 * Payload examples:
 *   { action: "updateSheet", spreadsheetId: "...", sheetId: 2126384446,
 *     updates: [{ a1: "F2", value: "Approved" }, { row: 3, column: "Comment", value: "OK" }] }
 *
 *   { action: "updateSheet", spreadsheetId: "...", sheetId: 2126384446,
 *     find: { column: "Name", equals: "Thapelo Nyathi" },
 *     set: { Status: "Approved", Comment: "Loaded" } }
 *
 *   { action: "updateSheet", spreadsheetId: "...", sheetId: 2126384446,
 *     append: { Name: "Jane Doe", Number: "0821234567", Status: "Pending" } }
 */
function updateSheet_(data) {
  var spreadsheetId =
    data.spreadsheetId ||
    data.workbookId ||
    LOADED_SHEET_ID;

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = resolveSheet_(ss, data);
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var written = [];

  if (data.append && typeof data.append === "object") {
    var row = sheet.getLastRow() + 1;
    if (row < 2) row = 2;
    var appendKeys = Object.keys(data.append);
    for (var a = 0; a < appendKeys.length; a++) {
      var aKey = appendKeys[a];
      var aCol = ensureColumn_(sheet, headers, aKey);
      var aVal = data.append[aKey];
      if (isPhoneColumn_(aKey)) writePhone_(sheet, row, aCol, aVal);
      else sheet.getRange(row, aCol).setValue(aVal);
      written.push({ row: row, column: aKey, value: aVal });
    }
  }

  if (data.find && data.set && typeof data.set === "object") {
    var findColName = data.find.column || data.find.header || "Name";
    var findVal = String(data.find.equals != null ? data.find.equals : data.find.value || "").trim();
    var findCol = headers.indexOf(findColName) + 1;
    if (findCol === 0) {
      return { ok: false, error: "Find column not found: " + findColName };
    }
    var last = sheet.getLastRow();
    if (last < 2) {
      return { ok: false, error: "No data rows to search" };
    }
    var cells = sheet.getRange(2, findCol, last - 1, 1).getValues();
    var matchedRow = 0;
    for (var i = 0; i < cells.length; i++) {
      if (String(cells[i][0]).trim().toLowerCase() === findVal.toLowerCase()) {
        matchedRow = i + 2;
        break;
      }
    }
    if (!matchedRow) {
      return { ok: false, error: "No row matched " + findColName + "=" + findVal };
    }
    var setKeys = Object.keys(data.set);
    for (var s = 0; s < setKeys.length; s++) {
      var sKey = setKeys[s];
      var sCol = ensureColumn_(sheet, headers, sKey);
      var sVal = data.set[sKey];
      if (isPhoneColumn_(sKey)) writePhone_(sheet, matchedRow, sCol, sVal);
      else sheet.getRange(matchedRow, sCol).setValue(sVal);
      written.push({ row: matchedRow, column: sKey, value: sVal });
    }
  }

  var updates = data.updates || data.cells || [];
  for (var u = 0; u < updates.length; u++) {
    var item = updates[u];
    if (item.a1) {
      sheet.getRange(String(item.a1)).setValue(item.value);
      written.push({ a1: item.a1, value: item.value });
      continue;
    }
    var rowNum = Number(item.row) || 0;
    if (!rowNum) {
      return { ok: false, error: "updates[] item needs a1 or row" };
    }
    var colNum = 0;
    if (item.columnIndex) colNum = Number(item.columnIndex);
    else if (item.column || item.header) {
      colNum = ensureColumn_(sheet, headers, item.column || item.header);
    } else if (item.col) {
      colNum = columnLetterToIndex_(item.col);
    }
    if (!colNum) {
      return { ok: false, error: "updates[] item needs column/header/col/columnIndex" };
    }
    var val = item.value;
    if (item.column && isPhoneColumn_(item.column)) writePhone_(sheet, rowNum, colNum, val);
    else sheet.getRange(rowNum, colNum).setValue(val);
    written.push({ row: rowNum, column: item.column || item.header || item.col || colNum, value: val });
  }

  if (written.length === 0) {
    return {
      ok: false,
      error: "Nothing to write. Provide updates[], or find+set, or append.",
    };
  }

  return {
    ok: true,
    spreadsheetId: spreadsheetId,
    sheetName: sheet.getName(),
    sheetId: sheet.getSheetId(),
    count: written.length,
    written: written,
  };
}

function resolveSheet_(ss, data) {
  var gid = data.sheetGid != null ? Number(data.sheetGid) : data.gid != null ? Number(data.gid) : null;
  // Common mistake: callers put the tab gid in sheetId. Prefer explicit spreadsheetId.
  if (gid == null && data.sheetId != null && data.spreadsheetId) {
    gid = Number(data.sheetId);
  }
  if (gid != null && !isNaN(gid)) {
    var byId = ss.getSheetById(gid);
    if (byId) return byId;
    throw new Error("No sheet with gid " + gid);
  }
  if (data.sheetName) {
    var byName = ss.getSheetByName(String(data.sheetName));
    if (byName) return byName;
    throw new Error("No sheet named " + data.sheetName);
  }
  return ss.getSheets()[0];
}

function isPhoneColumn_(name) {
  return /number|phone|mobile|cell/i.test(String(name || ""));
}

function columnLetterToIndex_(letter) {
  var s = String(letter || "").toUpperCase().replace(/[^A-Z]/g, "");
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
