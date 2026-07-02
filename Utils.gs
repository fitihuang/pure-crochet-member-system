function getSheet(sheetName) {
	return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}

// 同一次執行（一次 API 呼叫）內，同一張表只真的讀一次，避免迴圈裡重複讀整張表拖慢速度。
// 任何寫入動作都要呼叫 clearSheetCache()，不然會讀到寫入前的舊資料。
var sheetDataCache = {};

function getSheetAsObjects(sheetName) {
	if (!sheetDataCache[sheetName]) {
		sheetDataCache[sheetName] = readSheetAsObjects(sheetName);
	}
	return sheetDataCache[sheetName];
}

function readSheetAsObjects(sheetName) {
	var sheet = getSheet(sheetName);
	var values = sheet.getDataRange().getValues();
	var headers = values[0];
	var rows = [];
	for (var i = 1; i < values.length; i++) {
		var row = {};
		for (var j = 0; j < headers.length; j++) {
			row[headers[j]] = values[i][j];
		}
		row._rowNumber = i + 1;
		rows.push(row);
	}
	return rows;
}

function clearSheetCache() {
	sheetDataCache = {};
}

function getColumnIndexByHeader(sheetName, headerName) {
	var sheet = getSheet(sheetName);
	var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
	return headerRow.indexOf(headerName) + 1;
}

// 手動輸入的 ID 跟系統自動產生的 ID 共用同一套規則：抓目前最大編號 +1
function generateNextId(sheetName, idColumnName, prefix, padLength) {
	var rows = getSheetAsObjects(sheetName);
	var maxNumber = 0;
	rows.forEach(function (row) {
		var id = String(row[idColumnName] || '');
		if (id.indexOf(prefix) === 0) {
			var number = parseInt(id.substring(prefix.length), 10);
			if (!isNaN(number) && number > maxNumber) {
				maxNumber = number;
			}
		}
	});
	var nextNumber = maxNumber + 1;
	return prefix + String(nextNumber).padStart(padLength, '0');
}

// 依實際表頭順序組出一列資料，不用管欄位在 Sheet 裡實際排在第幾欄，避免之後改欄位順序時寫壞資料
function appendRowFromObject(sheetName, rowObject) {
	var sheet = getSheet(sheetName);
	var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
	var rowNumber = sheet.getLastRow() + 1;
	headers.forEach(function (header, index) {
		var value = rowObject[header] !== undefined ? rowObject[header] : '';
		writeCellSafely(sheet, rowNumber, index + 1, value);
	});
	clearSheetCache();
}

function updateRowFromObject(sheetName, rowNumber, rowObject) {
	var sheet = getSheet(sheetName);
	var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
	headers.forEach(function (header, index) {
		if (rowObject[header] !== undefined) {
			writeCellSafely(sheet, rowNumber, index + 1, rowObject[header]);
		}
	});
	clearSheetCache();
}

// 開頭是 0 的數字字串（例如手機號碼 0919xxxxxx）強制用文字格式寫入，
// 不然 Sheets 儲存格格式是「自動」時會被當成數字，開頭的 0 就不見了
function writeCellSafely(sheet, row, column, value) {
	var range = sheet.getRange(row, column);
	if (typeof value === 'string' && /^0\d+$/.test(value)) {
		range.setNumberFormat('@');
	}
	range.setValue(value);
}

function todayAtMidnight() {
	var now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
