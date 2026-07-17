import { getGoogleAccessToken } from './googleAuth.js';

// 這幾欄是已知的日期欄位，讀出來的原始序號要轉成 ISO 字串；
// 用「已知欄位名單」而不是猜數值範圍，避免跟金額/名額這類數字欄位搞混
const DATE_FIELDS = new Set(['活動日期', '報名截止日', '加入日期', '報名時間', '消費日期', '發放日期', '到期日']);

// Google Sheets 的日期序號是從 1899-12-30 起算的天數，且是以試算表設定的時區（appsscript.json 設的 Asia/Taipei，UTC+8）
// 為準的「當地時間」天數，不是 UTC，換算時要扣掉這個時差，不然會整整差 8 小時
const SPREADSHEET_TIMEZONE_OFFSET_MS = 8 * 3600000;

function serialDateToISOString(serial) {
	const epochMs = Date.UTC(1899, 11, 30);
	const rawMs = epochMs + serial * 86400000 - SPREADSHEET_TIMEZONE_OFFSET_MS;
	// 8小時換算成天數的分數是 1/3，浮點數運算會殘留極小誤差，四捨五入到最近一秒去掉那個雜訊
	const roundedMs = Math.round(rawMs / 1000) * 1000;
	return new Date(roundedMs).toISOString();
}

// 重要：Workers 同一個 isolate 可能會處理好幾個不同使用者的請求，
// 不能像 Apps Script 那樣用「模組層級的全域變數」當快取（那樣會讓不同請求之間看到彼此的舊資料）。
// 這裡改成每次請求呼叫 createSheetsClient() 產生一份「這次請求專用」的快取，
// 請求處理完，這個 client 物件就跟著被丟棄，不會汙染下一個請求。
export function createSheetsClient(env) {
	let accessTokenPromise = null;
	const rowsCache = {};
	const headersCache = {};

	async function getAccessToken() {
		if (!accessTokenPromise) {
			accessTokenPromise = getGoogleAccessToken(env);
		}
		return accessTokenPromise;
	}

	async function fetchRange(range) {
		const token = await getAccessToken();
		// valueRenderOption=UNFORMATTED_VALUE：日期會變成序號而不是「顯示用文字」，
		// 不然不同儲存格格式設定會讀出不一致的日期字串（同一張表就遇過兩種格式並存）
		const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + env.SPREADSHEET_ID +
			'/values/' + encodeURIComponent(range) + '?valueRenderOption=UNFORMATTED_VALUE';
		const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
		if (!res.ok) {
			return null;
		}
		const data = await res.json();
		return data.values || [];
	}

	async function getHeaders(sheetName) {
		if (!headersCache[sheetName]) {
			const values = await fetchRange(sheetName + '!1:1');
			headersCache[sheetName] = (values && values[0]) || [];
		}
		return headersCache[sheetName];
	}

	async function getSheetAsObjects(sheetName) {
		if (rowsCache[sheetName]) {
			return rowsCache[sheetName];
		}
		const values = await fetchRange(sheetName);
		if (!values || values.length === 0) {
			rowsCache[sheetName] = [];
			return [];
		}
		const headers = values[0];
		const rows = [];
		for (let i = 1; i < values.length; i++) {
			const row = {};
			headers.forEach((header, j) => {
				let value = values[i][j] !== undefined ? values[i][j] : '';
				if (DATE_FIELDS.has(header) && typeof value === 'number') {
					value = serialDateToISOString(value);
				}
				row[header] = value;
			});
			row._rowNumber = i + 1;
			rows.push(row);
		}
		rowsCache[sheetName] = rows;
		return rows;
	}

	async function sheetExists(sheetName) {
		const values = await fetchRange(sheetName + '!1:1');
		return values !== null;
	}

	function clearCache() {
		Object.keys(rowsCache).forEach((key) => delete rowsCache[key]);
	}

	// 手機號碼這類「開頭是0的數字字串」要強制當文字寫入，不然 Sheets 會自動轉數字吃掉開頭的0
	function toWriteValue(value) {
		if (typeof value === 'string' && /^0\d+$/.test(value)) {
			return "'" + value; // USER_ENTERED 模式下，開頭加單引號會強制當文字
		}
		return value;
	}

	async function appendRowFromObject(sheetName, rowObject) {
		const headers = await getHeaders(sheetName);
		const row = headers.map((h) => (rowObject[h] !== undefined ? toWriteValue(rowObject[h]) : ''));
		const token = await getAccessToken();
		const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + env.SPREADSHEET_ID +
			'/values/' + encodeURIComponent(sheetName) + ':append?valueInputOption=USER_ENTERED';
		const res = await fetch(url, {
			method: 'POST',
			headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ values: [row] })
		});
		if (!res.ok) {
			throw new Error('寫入 ' + sheetName + ' 失敗：' + (await res.text()));
		}
		clearCache();
	}

	async function updateRowFromObject(sheetName, rowNumber, rowObject) {
		const headers = await getHeaders(sheetName);
		const data = [];
		headers.forEach((header, index) => {
			if (rowObject[header] !== undefined) {
				data.push({
					range: sheetName + '!' + columnLetter(index) + rowNumber,
					values: [[toWriteValue(rowObject[header])]]
				});
			}
		});
		if (data.length === 0) return;

		const token = await getAccessToken();
		const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + env.SPREADSHEET_ID + '/values:batchUpdate';
		const res = await fetch(url, {
			method: 'POST',
			headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
		});
		if (!res.ok) {
			throw new Error('更新 ' + sheetName + ' 失敗：' + (await res.text()));
		}
		clearCache();
	}

	async function generateNextId(sheetName, idColumnName, prefix, padLength) {
		const rows = await getSheetAsObjects(sheetName);
		let maxNumber = 0;
		rows.forEach((row) => {
			const id = String(row[idColumnName] || '');
			if (id.indexOf(prefix) === 0) {
				const number = parseInt(id.substring(prefix.length), 10);
				if (!isNaN(number) && number > maxNumber) maxNumber = number;
			}
		});
		return prefix + String(maxNumber + 1).padStart(padLength, '0');
	}

	return {
		getSheetAsObjects,
		sheetExists,
		appendRowFromObject,
		updateRowFromObject,
		generateNextId,
		clearCache
	};
}

function columnLetter(index) {
	let letter = '';
	let n = index;
	while (n >= 0) {
		letter = String.fromCharCode((n % 26) + 65) + letter;
		n = Math.floor(n / 26) - 1;
	}
	return letter;
}
