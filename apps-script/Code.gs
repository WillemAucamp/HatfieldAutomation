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
 *                   (also insertColumn + dataValidation dropdowns)
 *   readSheet     — read rows (used for Google Form intake)
 *   appendApplicant — append a formatted finance row on the automation sheet
 *
 * Operator menu (after this file is in Apps Script, reload the spreadsheet):
 *   Hatfield → Process now / Ingest only / Load open rows
 *   Hatfield → Turn on 5-minute GitHub poll — external cron using GITHUB_TOKEN (idle-aware)
 *   Needs script properties GITHUB_TOKEN (and optional GITHUB_REPO / GITHUB_REF).
 *
 * The account that deploys this must be able to edit the intake Form sheet
 * AND the automation / loaded-clients sheets.
 */

var SOURCE_SHEET_ID = "12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI";
var LOADED_SHEET_ID = "1V8re1qmdC0AXyDKt9G3gQxcqmn3q9hAJeM_YpUkjRLM";
var INTAKE_SHEET_ID = "1qzp0v1_lHzAUj7TGXIj-cz0zuWctBX8de1wR46hKcLY";
/** Willem/Sihle person tab only — other assignee tabs are ignored. From sheet URL gid=. */
var INTAKE_SHEET_GID = 880063023;
var INTAKE_SHEET_NAME = "Willem/ Sihle";
/** Leads tab (Name / Number / Status). From the sheet URL gid=. */
var LEADS_SHEET_GID = 2126384446;
/** Approved follow-up tab. Approvals on Leads are copied here. */
var APPROVED_SHEET_GID = 1730847217;
var LEADS_STATUS_HEADER = "Status";
var LEADS_WHATSAPP_SENT_HEADER = "WhatsApp sent";

function doGet() {
  // Client code (postWebhookJson) retries when a 302 confirmation wrongly
  // returns this probe instead of the doPost JSON — keep shape stable.
  return json_({
    ok: true,
    version: "hatfield-intake-3",
    actions: [
      "appendLoaded",
      "writeStatus",
      "renumberRows",
      "updateSheet",
      "readSheet",
      "appendApplicant",
    ],
    leadsSheetGid: LEADS_SHEET_GID,
    approvedSheetGid: APPROVED_SHEET_GID,
  });
}

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
    if (action === "readSheet") {
      return json_(readSheet_(data));
    }
    if (action === "appendApplicant") {
      return json_(appendApplicant_(data));
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
  var text = String(value == null ? "" : value).replace(/^'/, "");
  sheet.getRange(row, col).setNumberFormat("@").setValue(text);
}

function normalizeSaMobile_(raw) {
  var text = String(raw == null ? "" : raw).trim();
  var digits = text.replace(/\D/g, "");
  if (/e\+/i.test(text)) {
    var asNum = Number(text);
    if (isFinite(asNum)) digits = String(Math.round(asNum));
  }
  if (digits.indexOf("27") === 0 && digits.length >= 11) digits = digits.substring(2);
  if (digits.length === 9) digits = "0" + digits;
  if (digits.length === 10 && digits.charAt(0) === "0") return digits;
  return "";
}

function normPerson_(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function collapseDoubled_(name) {
  var parts = name.split(" ");
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
  return name;
}

function samePerson_(a, b) {
  var left = normPerson_(a);
  var right = normPerson_(b);
  if (!left || !right) return false;
  return collapseDoubled_(left) === collapseDoubled_(right);
}

function sheetByGid_(ss, gid) {
  if (gid == null || gid === "") return ss.getSheets()[0];
  var id = Number(gid);
  if (isNaN(id)) throw new Error("No sheet with gid " + gid);
  var byId = ss.getSheetById(id);
  if (!byId) throw new Error("No sheet with gid " + id);
  return byId;
}

function appendLoaded_(data) {
  var ss = SpreadsheetApp.openById(data.loadedSheetId || LOADED_SHEET_ID);
  var gid = data.sheetGid != null ? Number(data.sheetGid) : LEADS_SHEET_GID;
  var sheet = sheetByGid_(ss, gid);
  var nameColumn = data.nameColumn || "Name";
  var numberColumn = data.numberColumn || "Number";
  var headers = ensureHeaders_(sheet, [nameColumn, numberColumn]);
  var nameCol = headers.indexOf(nameColumn) + 1;
  var numberCol = headers.indexOf(numberColumn) + 1;

  var name = String(data.name || "")
    .trim()
    .replace(/\s+/g, " ");
  var number = normalizeSaMobile_(data.number || data.mobile) || String(data.number || data.mobile || "").trim();
  if (!name || !number) {
    return { ok: false, error: "name and number are required" };
  }

  var last = Math.max(sheet.getLastRow(), 1);
  if (last >= 2) {
    var names = sheet.getRange(2, nameCol, last - 1, 1).getValues();
    var numbers = sheet.getRange(2, numberCol, last - 1, 1).getValues();
    for (var i = 0; i < names.length; i++) {
      if (!samePerson_(names[i][0], name)) continue;
      var row = i + 2;
      var existing = normalizeSaMobile_(numbers[i][0]);
      var incoming = normalizeSaMobile_(number);
      if (existing && incoming && existing === incoming) {
        return { ok: true, skipped: true, row: row, name: name, number: number };
      }
      writePhone_(sheet, row, numberCol, incoming || number);
      return { ok: true, updated: true, row: row, name: name, number: incoming || number };
    }
    for (var j = 0; j < numbers.length; j++) {
      var stored = normalizeSaMobile_(numbers[j][0]);
      if (!stored || stored !== normalizeSaMobile_(number)) continue;
      if (String(names[j][0] || "").trim()) continue;
      writePhone_(sheet, j + 2, numberCol, number);
      sheet.getRange(j + 2, nameCol).setValue(name);
      return { ok: true, updated: true, row: j + 2, name: name, number: number };
    }
  }

  var appendRow = last + 1;
  if (last === 1 && !sheet.getRange(1, nameCol).getValue()) {
    appendRow = 2;
  }
  sheet.getRange(appendRow, nameCol).setValue(name);
  writePhone_(sheet, appendRow, numberCol, normalizeSaMobile_(number) || number);
  return { ok: true, row: appendRow, name: name, number: number };
}

/**
 * updateSheet writes do not fire onEdit. If this write set Leads Status to Approved,
 * copy that client onto the Approved tab.
 */
function maybeCarryApprovedFromWrites_(sheet, written) {
  if (!sheet || sheet.getSheetId() !== LEADS_SHEET_GID) return;
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var statusCol = headers.indexOf(LEADS_STATUS_HEADER) + 1;
  var nameCol = headers.indexOf("Name") + 1;
  var numberCol = headers.indexOf("Number") + 1;
  if (!statusCol || !nameCol || !numberCol) return;

  var rows = {};
  for (var i = 0; i < written.length; i++) {
    var item = written[i] || {};
    var rowNum = Number(item.row) || 0;
    var colName = String(item.column || "");
    if (item.a1) {
      var colLetter = String(item.a1).replace(/[0-9]/g, "");
      rowNum = parseInt(String(item.a1).replace(/\D/g, ""), 10) || 0;
      if (columnLetterToIndex_(colLetter) !== statusCol) continue;
      colName = LEADS_STATUS_HEADER;
    }
    if (!rowNum || !/^status$/i.test(colName)) continue;
    if (String(item.value || "").trim().toLowerCase() !== "approved") continue;
    rows[rowNum] = true;
  }

  for (var key in rows) {
    if (!rows.hasOwnProperty(key)) continue;
    var r = Number(key);
    try {
      carryApprovedLead_(
        String(sheet.getRange(r, nameCol).getValue() || ""),
        String(sheet.getRange(r, numberCol).getValue() || "")
      );
    } catch (carryErr) {
      console.error(carryErr);
    }
  }
}

/**
 * Put an Approved lead on the Approved follow-up tab if they are not already there.
 * Same cellphone under a different name still gets a row — do not hide the new client.
 */
function carryApprovedLead_(name, number) {
  var cleanName = String(name || "")
    .trim()
    .replace(/\s+/g, " ");
  var phone = normalizeSaMobile_(number);
  if (!cleanName || !phone) return { ok: false, error: "name and number are required" };

  var ss = SpreadsheetApp.openById(LOADED_SHEET_ID);
  var sheet = ss.getSheetById(APPROVED_SHEET_GID);
  if (!sheet) return { ok: false, error: "Approved tab missing" };

  var headers = ensureHeaders_(sheet, ["Name", "Number"]);
  var nameCol = headers.indexOf("Name") + 1;
  var numberCol = headers.indexOf("Number") + 1;
  var last = Math.max(sheet.getLastRow(), 1);
  if (last >= 2) {
    var names = sheet.getRange(2, nameCol, last - 1, 1).getValues();
    var numbers = sheet.getRange(2, numberCol, last - 1, 1).getValues();
    for (var i = 0; i < names.length; i++) {
      if (samePerson_(names[i][0], cleanName)) {
        return { ok: true, skipped: true, row: i + 2, name: cleanName };
      }
      if (!String(names[i][0] || "").trim() && normalizeSaMobile_(numbers[i][0]) === phone) {
        sheet.getRange(i + 2, nameCol).setValue(cleanName);
        writePhone_(sheet, i + 2, numberCol, phone);
        return { ok: true, updated: true, row: i + 2, name: cleanName };
      }
    }
  }

  var row = Math.max(last + 1, 2);
  sheet.getRange(row, nameCol).setValue(cleanName);
  writePhone_(sheet, row, numberCol, phone);
  return { ok: true, row: row, name: cleanName, number: phone };
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
  // getRange(row, column, numRows, numColumns) — not end-row corners.
  sheet.getRange(2, 1, count, 1).setValues(values);
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
 *
 *   { action: "updateSheet", spreadsheetId: "...", sheetGid: 2126384446,
 *     insertColumn: { after: "C", header: "Email sent", validation: ["Yes", "No"] } }
 *
 *   { action: "updateSheet", spreadsheetId: "...", sheetGid: 2126384446,
 *     dataValidation: { column: "Email sent", options: ["Yes", "No"] } }
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

  if (data.insertColumn && typeof data.insertColumn === "object") {
    var insertResult = insertColumn_(sheet, headers, data.insertColumn);
    written.push(insertResult);
    headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  }

  if (data.dataValidation && typeof data.dataValidation === "object") {
    var dvResult = applyDataValidation_(sheet, headers, data.dataValidation);
    written.push(dvResult);
  }

  if (data.append && typeof data.append === "object") {
    var row = sheet.getLastRow() + 1;
    if (row < 2) row = 2;
    var appendKeys = Object.keys(data.append);
    for (var a = 0; a < appendKeys.length; a++) {
      var aKey = appendKeys[a];
      var aCol = ensureColumn_(sheet, headers, aKey);
      var aVal = data.append[aKey];
      writePlain_(sheet, row, aCol, aKey, aVal);
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
      writePlain_(sheet, matchedRow, sCol, sKey, sVal);
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
    var colName = item.column || item.header || "";
    if (colName) writePlain_(sheet, rowNum, colNum, colName, val);
    else if (isPhoneColumn_(colName)) writePhone_(sheet, rowNum, colNum, val);
    else sheet.getRange(rowNum, colNum).setValue(val);
    written.push({ row: rowNum, column: colName || item.col || colNum, value: val });
  }

  if (written.length === 0) {
    return {
      ok: false,
      error:
        "Nothing to write. Provide updates[], find+set, append, insertColumn, or dataValidation.",
    };
  }

  // Webhook edits do not fire onEdit, so copy Approved leads here too.
  maybeCarryApprovedFromWrites_(sheet, written);

  return {
    ok: true,
    spreadsheetId: spreadsheetId,
    sheetName: sheet.getName(),
    sheetId: sheet.getSheetId(),
    count: written.length,
    written: written,
  };
}

/**
 * Insert a column after a given letter/index, optionally set header + dropdown.
 * Idempotent when header already exists: skips insert, refreshes validation.
 */
function insertColumn_(sheet, headers, spec) {
  var header = spec.header != null ? String(spec.header) : "";
  var existingCol = header ? headers.indexOf(header) + 1 : 0;
  var newCol = existingCol;
  var inserted = false;

  if (!newCol) {
    var afterIndex = 0;
    if (spec.afterIndex != null) afterIndex = Number(spec.afterIndex);
    else if (spec.afterColumnIndex != null) afterIndex = Number(spec.afterColumnIndex);
    else if (spec.after != null || spec.afterColumn != null || spec.afterCol != null) {
      afterIndex = columnLetterToIndex_(spec.after || spec.afterColumn || spec.afterCol);
    } else if (spec.before != null || spec.beforeColumn != null || spec.beforeCol != null) {
      afterIndex = columnLetterToIndex_(spec.before || spec.beforeColumn || spec.beforeCol) - 1;
    }
    if (!afterIndex || afterIndex < 0) {
      throw new Error("insertColumn needs after/afterIndex (e.g. after: \"C\")");
    }
    sheet.insertColumnAfter(afterIndex);
    newCol = afterIndex + 1;
    inserted = true;
    if (header) {
      sheet.getRange(1, newCol).setValue(header);
    }
  } else if (header) {
    sheet.getRange(1, newCol).setValue(header);
  }

  var options = normalizeValidationOptions_(spec.validation || spec.dropdown || spec.options);
  var validationRows = null;
  if (options && options.length) {
    validationRows = setColumnValidation_(sheet, newCol, options, spec);
  }

  return {
    op: "insertColumn",
    inserted: inserted,
    columnIndex: newCol,
    column: columnIndexToLetter_(newCol),
    header: header || null,
    validation: options,
    validationRows: validationRows,
  };
}

function applyDataValidation_(sheet, headers, spec) {
  var colNum = 0;
  if (spec.columnIndex) colNum = Number(spec.columnIndex);
  else if (spec.col) colNum = columnLetterToIndex_(spec.col);
  else if (spec.column || spec.header) {
    colNum = headers.indexOf(spec.column || spec.header) + 1;
    if (!colNum) {
      throw new Error("dataValidation column not found: " + (spec.column || spec.header));
    }
  }
  if (!colNum) {
    throw new Error("dataValidation needs column/header/col/columnIndex");
  }
  var options = normalizeValidationOptions_(spec.options || spec.validation || spec.dropdown);
  if (!options || !options.length) {
    throw new Error("dataValidation needs options (e.g. [\"Yes\",\"No\"])");
  }
  var validationRows = setColumnValidation_(sheet, colNum, options, spec);
  return {
    op: "dataValidation",
    columnIndex: colNum,
    column: columnIndexToLetter_(colNum),
    validation: options,
    validationRows: validationRows,
  };
}

function normalizeValidationOptions_(raw) {
  if (raw == null || raw === "") return null;
  if (Object.prototype.toString.call(raw) === "[object Array]") {
    return raw.map(function (v) {
      return String(v);
    });
  }
  return String(raw)
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

function setColumnValidation_(sheet, colNum, options, spec) {
  var lastRow = sheet.getLastRow();
  var fromRow = Number(spec.fromRow) || 2;
  var toRow = Number(spec.toRow) || Math.max(lastRow, Number(spec.validationRows) || 2000);
  if (toRow < fromRow) toRow = fromRow;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(fromRow, colNum, toRow, colNum).setDataValidation(rule);
  return { fromRow: fromRow, toRow: toRow };
}

function columnIndexToLetter_(index) {
  var n = Number(index) || 0;
  var s = "";
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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
  // Shared intakes workbook: default to the Willem/Sihle person tab only.
  if (ss.getId() === INTAKE_SHEET_ID) {
    var intakeTab =
      ss.getSheetById(INTAKE_SHEET_GID) || ss.getSheetByName(INTAKE_SHEET_NAME);
    if (intakeTab) return intakeTab;
  }
  return ss.getSheets()[0];
}

function isPhoneColumn_(name) {
  var n = String(name || "");
  // Do not treat "Telephone payment" as a phone — that expense must stay numeric.
  if (/payment|cost|salary|expense|gross|nett/i.test(n)) return false;
  // "Spouse number" has no phone/mobile/cell token but must stay text (leading 0).
  if (/spouse\s*number/i.test(n)) return true;
  // Money-sheet cellphone column. Not "ID number" / "Spouse number".
  if (/^number$/i.test(n.trim())) return true;
  return /(phone|mobile|cell)/i.test(n);
}

function isPostalColumn_(name) {
  return /postal\s*code/i.test(String(name || ""));
}

function columnLetterToIndex_(letter) {
  var s = String(letter || "").toUpperCase().replace(/[^A-Z]/g, "");
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}

function isIdColumn_(name) {
  return /id number/i.test(String(name || ""));
}

function isDateColumn_(name) {
  return /date|mm dd yyyy|year start|started working/i.test(String(name || ""));
}

function writePlain_(sheet, row, col, name, value) {
  var text = value == null ? "" : String(value);
  // Force plain text for IDs, phones, dates, and postal codes so Sheets does not
  // strip leading zeros (0083 → 83) or convert MM DD YYYY into Date serials.
  if (
    isPhoneColumn_(name) ||
    isIdColumn_(name) ||
    isDateColumn_(name) ||
    isPostalColumn_(name)
  ) {
    if (isPhoneColumn_(name)) text = text.replace(/^'/, "");
    sheet.getRange(row, col).setNumberFormat("@").setValue(text);
    return;
  }
  sheet.getRange(row, col).setValue(value);
}

/**
 * Read a sheet as header → value records.
 * { action: "readSheet", spreadsheetId, unprocessedOnly: true,
 *   statusColumn: "Enrichment Status", processableStatuses: ["", "new", "retry"] }
 */
function readSheet_(data) {
  var spreadsheetId = data.spreadsheetId || data.intakeSheetId || INTAKE_SHEET_ID;
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = resolveSheet_(ss, data);
  var statusColumn = data.statusColumn != null ? String(data.statusColumn) : "";
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  if (statusColumn) {
    ensureColumn_(sheet, headers, statusColumn);
    headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var rows = [];
  var processable = (data.processableStatuses || ["", "new", "retry"]).map(function (s) {
    return String(s).trim().toLowerCase();
  });
  var statusIdx = statusColumn ? headers.indexOf(statusColumn) : -1;
  // Enrichment Status on the Form sheet: only Melrose pipeline values are terminal.
  // Form answers that leaked into that column (e.g. "Im not sure, but it should be GOOD")
  // must not hide new submissions. Other sheets keep processableStatuses allowlist.
  var intakeEnrichmentCol = /enrichment\s*status/i.test(statusColumn);
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < values.length; i++) {
      var status = statusIdx >= 0 ? String(values[i][statusIdx] || "").trim().toLowerCase() : "";
      if (data.unprocessedOnly) {
        if (intakeEnrichmentCol) {
          // enriched row 0 = lost append confirmation — keep processable.
          if (
            /^(enriched\b|skipped_|processing\b|error\b)/i.test(status) &&
            !/^enriched row 0\b/i.test(status)
          ) {
            continue;
          }
        } else if (processable.indexOf(status) === -1) {
          continue;
        }
      }
      var record = {};
      for (var c = 0; c < headers.length; c++) {
        var h = String(headers[c] || "");
        if (!h) continue;
        var cell = values[i][c];
        if (cell instanceof Date) {
          record[h] = Utilities.formatDate(cell, Session.getScriptTimeZone(), "MM dd yyyy");
        } else {
          record[h] = cell == null ? "" : String(cell);
        }
      }
      rows.push({ rowIndex: i + 2, status: status, values: record });
    }
  }
  return {
    ok: true,
    spreadsheetId: spreadsheetId,
    sheetName: sheet.getName(),
    headers: headers.map(function (h) {
      return String(h || "");
    }),
    rows: rows,
  };
}

/**
 * Append one formatted applicant row to the automation sheet.
 * Assigns the next NR and leaves Status/Timing empty unless provided.
 */
function appendApplicant_(data) {
  var ss = SpreadsheetApp.openById(data.spreadsheetId || data.sourceSheetId || SOURCE_SHEET_ID);
  var sheet = resolveSheet_(ss, data);
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var nrColumn = data.nrColumn || "NR";
  var statusColumn = data.statusColumn || "Status";
  var timingColumn = data.timingColumn || "Timing";
  var nrCol = ensureColumn_(sheet, headers, nrColumn);
  ensureColumn_(sheet, headers, statusColumn);
  ensureColumn_(sheet, headers, timingColumn);

  var lastRow = sheet.getLastRow();
  var nextNr = 1;
  if (lastRow >= 2) {
    var nrs = sheet.getRange(2, nrCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < nrs.length; i++) {
      var n = Number(nrs[i][0]);
      if (!isNaN(n) && n >= nextNr) nextNr = n + 1;
    }
  }

  var values = data.values || data.append || {};
  values[nrColumn] = values[nrColumn] != null && values[nrColumn] !== "" ? values[nrColumn] : nextNr;
  if (values[statusColumn] == null) values[statusColumn] = "";
  if (values[timingColumn] == null) values[timingColumn] = "";

  var row = Math.max(lastRow + 1, 2);
  var keys = Object.keys(values);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var col = ensureColumn_(sheet, headers, key);
    writePlain_(sheet, row, col, key, values[key]);
  }
  return {
    ok: true,
    row: row,
    nr: values[nrColumn],
    spreadsheetId: ss.getId(),
    sheetName: sheet.getName(),
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// Prefer n8n. Legacy Cursor props still work as fallback.
var N8N_WEBHOOK_PROP = "N8N_WEBHOOK_URL";
var N8N_WEBHOOK_KEY_PROP = "N8N_WEBHOOK_API_KEY";
var CURSOR_WEBHOOK_PROP = "CURSOR_WEBHOOK_URL";
var CURSOR_WEBHOOK_KEY_PROP = "CURSOR_WEBHOOK_API_KEY";

function notifyOrchestrator_(payload) {
  var props = PropertiesService.getScriptProperties();
  var url =
    props.getProperty(N8N_WEBHOOK_PROP) || props.getProperty(CURSOR_WEBHOOK_PROP);
  if (!url) {
    return {
      ok: false,
      skipped: true,
      reason: "N8N_WEBHOOK_URL (or legacy CURSOR_WEBHOOK_URL) not set",
    };
  }
  var key =
    props.getProperty(N8N_WEBHOOK_KEY_PROP) ||
    props.getProperty(CURSOR_WEBHOOK_KEY_PROP) ||
    "";
  var headers = {};
  if (key) {
    headers.Authorization = "Bearer " + key;
    headers["X-API-Key"] = key;
  }
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify(payload || { event: "intake_changed" }),
    muteHttpExceptions: true,
    followRedirects: true,
  });
  return {
    ok: res.getResponseCode() >= 200 && res.getResponseCode() < 300,
    status: res.getResponseCode(),
  };
}

/** @deprecated use notifyOrchestrator_ */
function notifyCursorAutomation_(payload) {
  return notifyOrchestrator_(payload);
}

function onIntakeChange(e) {
  notifyOrchestrator_({
    event: "intake_form_submit",
    changeType: e && e.changeType,
    spreadsheetId: INTAKE_SHEET_ID,
  });
}

/**
 * Optional leftover. Do not run this unless you still use n8n auto-trigger.
 * Production is a manual GitHub Actions click (or the Hatfield menu below).
 */
function setupIntakeWatch() {
  var ss = SpreadsheetApp.openById(INTAKE_SHEET_ID);
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "onIntakeChange") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("onIntakeChange").forSpreadsheet(ss).onFormSubmit().create();
  return { ok: true, spreadsheet: ss.getName(), handler: "onIntakeChange" };
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Hatfield")
    .addItem("Process now (intake → Seriti)", "menuProcessFull")
    .addItem("Ingest only (Gemini → automation sheet)", "menuIngestOnly")
    .addItem("Load open rows (Seriti only)", "menuLoadOnly")
    .addSeparator()
    .addItem("Turn on 5-minute GitHub poll", "menuTurnOnPipelinePoll")
    .addItem("Turn off 5-minute GitHub poll", "menuTurnOffPipelinePoll")
    .addSeparator()
    .addItem("Mark old Form rows skipped…", "menuSkipHistorical")
    .addToUi();
}

function menuProcessFull() {
  dispatchGitHubWorkflow_("full");
}

function menuIngestOnly() {
  dispatchGitHubWorkflow_("ingest-only");
}

function menuLoadOnly() {
  dispatchGitHubWorkflow_("load-only");
}

/** Time-driven trigger — no UI. Dispatches with scheduledTick so idle ticks stay cheap. */
function pollGitHubPipeline_() {
  dispatchGitHubWorkflowCore_("full", true, false);
}

function menuTurnOnPipelinePoll() {
  var ui = SpreadsheetApp.getUi();
  var removed = deleteProjectTriggers_("pollGitHubPipeline_");
  ScriptApp.newTrigger("pollGitHubPipeline_").timeBased().everyMinutes(5).create();
  ui.alert(
    "5-minute poll enabled",
    "Google will call GitHub Actions about every 5 minutes when this script project is active.\n\n" +
      "Uses the same GITHUB_TOKEN as Process now, with scheduledTick=true (skip Seriti when idle).\n\n" +
      (removed > 0 ? "Replaced " + removed + " old poll trigger(s).\n\n" : "") +
      "Requires intake-to-melrose.yml on main with the scheduledTick input (merged PR #36).",
    ui.ButtonSet.OK
  );
}

function menuTurnOffPipelinePoll() {
  var ui = SpreadsheetApp.getUi();
  var removed = deleteProjectTriggers_("pollGitHubPipeline_");
  ui.alert(
    "Poll disabled",
    removed > 0 ? "Removed " + removed + " poll trigger(s)." : "No poll trigger was active.",
    ui.ButtonSet.OK
  );
}

function deleteProjectTriggers_(handlerName) {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return removed;
}

function dispatchGitHubWorkflow_(mode) {
  dispatchGitHubWorkflowCore_(mode, false, true);
}

function dispatchGitHubWorkflowCore_(mode, scheduledTick, showUi) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("GITHUB_TOKEN");
  var repo = props.getProperty("GITHUB_REPO") || "WillemAucamp/HatfieldAutomation";
  var workflow = props.getProperty("GITHUB_WORKFLOW") || "intake-to-melrose.yml";
  var ref = props.getProperty("GITHUB_REF") || "main";
  var maxRows = props.getProperty("MAX_INTAKE_ROWS") || "5";
  var ui = showUi ? SpreadsheetApp.getUi() : null;

  if (!token) {
    if (ui) {
      ui.alert(
        "GitHub token missing",
        "Open Extensions → Apps Script → Project Settings → Script properties and add:\n\n" +
          "GITHUB_TOKEN = a GitHub personal access token with Actions: write\n" +
          "GITHUB_REPO = WillemAucamp/HatfieldAutomation  (optional)\n" +
          "GITHUB_REF = main  (or cursor/full-chain-seriti-df0d until that PR is merged)\n\n" +
          "Until then, run the pipeline from GitHub → Actions → Intake to Melrose → Run workflow.",
        ui.ButtonSet.OK
      );
    }
    return { ok: false, code: 0, error: "GITHUB_TOKEN missing" };
  }

  var url =
    "https://api.github.com/repos/" + repo + "/actions/workflows/" + workflow + "/dispatches";
  var body = {
    ref: ref,
    inputs: {
      mode: String(mode || "full"),
      maxIntakeRows: String(maxRows),
      dryRun: "false",
      scheduledTick: scheduledTick ? "true" : "false",
    },
  };

  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hatfield-apps-script",
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code === 204 || code === 200) {
    if (ui) {
      ui.alert(
        "Started",
        "GitHub Actions is running mode=" +
          mode +
          " on " +
          repo +
          "@" +
          ref +
          ".\n\nWatch it at:\nhttps://github.com/" +
          repo +
          "/actions",
        ui.ButtonSet.OK
      );
    }
    return { ok: true, code: code };
  }
  if (ui) {
    ui.alert(
      "GitHub did not start the run",
      "HTTP " + code + "\n" + res.getContentText().slice(0, 500),
      ui.ButtonSet.OK
    );
  }
  return { ok: false, code: code, body: res.getContentText().slice(0, 500) };
}

/**
 * One-time backlog cleanup. Sets blank Enrichment Status cells to skipped_historical
 * so a Process now click does not send old Form rows through Gemini + Seriti.
 */
function menuSkipHistorical() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "Skip historical intake?",
    "This writes skipped_historical on every Form row whose Enrichment Status is blank. New submits stay processable. Continue?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var ss = SpreadsheetApp.openById(INTAKE_SHEET_ID);
  var sheet = ss.getSheetById(INTAKE_SHEET_GID) || ss.getSheetByName(INTAKE_SHEET_NAME);
  if (!sheet) {
    ui.alert("Could not find intake tab " + INTAKE_SHEET_NAME + " (gid " + INTAKE_SHEET_GID + ").");
    return;
  }
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    ui.alert("No intake data rows.");
    return;
  }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var statusCol = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === "Enrichment Status") {
      statusCol = i + 1;
      break;
    }
  }
  if (statusCol < 1) {
    ui.alert("No Enrichment Status column on the intake sheet.");
    return;
  }
  var range = sheet.getRange(2, statusCol, lastRow - 1, 1);
  var values = range.getValues();
  var written = 0;
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0]).trim() === "") {
      values[r][0] = "skipped_historical";
      written++;
    }
  }
  if (written > 0) range.setValues(values);
  ui.alert("Marked " + written + " Form row(s) skipped_historical.");
}

function isNotifiableLeadStatus_(value) {
  var s = String(value || "")
    .trim()
    .toLowerCase();
  return s === "approved" || s === "declined";
}

/**
 * Installable onEdit: when Leads Status becomes Approved/Declined, ping Cursor
 * so the agent can run `npm run notify-leads`. WhatsApp secrets stay in Node.
 *
 * Also ensures a "WhatsApp sent" column exists (Yes/No dropdown).
 */
function onLeadsEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getSheetId() !== LEADS_SHEET_GID) return;
  if (e.range.getRow() < 2) return;

  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var statusCol = headers.indexOf(LEADS_STATUS_HEADER) + 1;
  if (!statusCol) return;

  var editedCol = e.range.getColumn();
  var editedCols = e.range.getNumColumns();
  var touchesStatus =
    editedCol <= statusCol && editedCol + editedCols - 1 >= statusCol;
  if (!touchesStatus) return;

  var startRow = e.range.getRow();
  var numRows = e.range.getNumRows();
  var nameCol = headers.indexOf("Name") + 1;
  var numberCol = headers.indexOf("Number") + 1;
  ensureColumn_(sheet, headers, LEADS_WHATSAPP_SENT_HEADER);
  headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var sentCol = headers.indexOf(LEADS_WHATSAPP_SENT_HEADER) + 1;
  if (sentCol) {
    setColumnValidation_(sheet, sentCol, ["Yes", "No"], { fromRow: 2, toRow: 2000 });
  }

  var notified = [];
  for (var r = 0; r < numRows; r++) {
    var row = startRow + r;
    var status = String(sheet.getRange(row, statusCol).getValue() || "").trim();
    if (!isNotifiableLeadStatus_(status)) continue;
    var leadName = nameCol ? String(sheet.getRange(row, nameCol).getValue() || "") : "";
    var leadNumber = numberCol ? String(sheet.getRange(row, numberCol).getValue() || "") : "";
    // Copy even when WhatsApp was already sent — the Approved tab is a separate miss.
    if (String(status).trim().toLowerCase() === "approved") {
      try {
        carryApprovedLead_(leadName, leadNumber);
      } catch (carryErr) {
        console.error(carryErr);
      }
    }
    var sent = sentCol ? String(sheet.getRange(row, sentCol).getValue() || "").trim() : "";
    if (/^yes$/i.test(sent) || /^sent/i.test(sent)) continue;
    notified.push({
      rowIndex: row,
      status: status,
      name: leadName,
      number: leadNumber,
    });
  }
  if (!notified.length) return;

  notifyCursorAutomation_({
    event: "leads_status_changed",
    spreadsheetId: LOADED_SHEET_ID,
    sheetGid: LEADS_SHEET_GID,
    rows: notified,
    instruction: "npm run notify-leads -- --once",
  });
}

/**
 * Run once from the Apps Script editor after CURSOR_WEBHOOK_URL is set.
 * Creates an installable onEdit trigger on the loaded-clients / Leads spreadsheet.
 */
function setupLeadsWhatsAppWatch() {
  var ss = SpreadsheetApp.openById(LOADED_SHEET_ID);
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "onLeadsEdit") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("onLeadsEdit").forSpreadsheet(ss).onEdit().create();
  return {
    ok: true,
    spreadsheet: ss.getName(),
    handler: "onLeadsEdit",
    leadsSheetGid: LEADS_SHEET_GID,
  };
}
