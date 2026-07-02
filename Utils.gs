function getSheet(sheetName) {
	return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}

// 把整張表讀成物件陣列，key 是表頭文字，方便用中文欄位名直接取值
function getSheetAsObjects(sheetName) {
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
	var row = headers.map(function (header) {
		return rowObject[header] !== undefined ? rowObject[header] : '';
	});
	sheet.appendRow(row);
}

function updateRowFromObject(sheetName, rowNumber, rowObject) {
	var sheet = getSheet(sheetName);
	var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
	headers.forEach(function (header, index) {
		if (rowObject[header] !== undefined) {
			sheet.getRange(rowNumber, index + 1).setValue(rowObject[header]);
		}
	});
}

function todayAtMidnight() {
	var now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
