const SPREADSHEET_TIMEZONE_OFFSET_MS = 8 * 3600000; // Asia/Taipei

// 回傳「今天」在台北時區的午夜，用 UTC 表示 —— 不能直接用 UTC 午夜，
// 不然會跟台北時間差 8 小時，把「今天」的活動誤判成已過期
export function todayAtMidnight() {
	const now = new Date();
	const taipeiNow = new Date(now.getTime() + SPREADSHEET_TIMEZONE_OFFSET_MS);
	const taipeiMidnightAsIfUTC = Date.UTC(taipeiNow.getUTCFullYear(), taipeiNow.getUTCMonth(), taipeiNow.getUTCDate());
	return new Date(taipeiMidnightAsIfUTC - SPREADSHEET_TIMEZONE_OFFSET_MS);
}

// 把一個絕對時間點轉成它在台北時區看起來的「YYYY-MM-DD」，用來判斷兩個時間是不是「同一天」
export function toTaipeiDateString(date) {
	const taipei = new Date(date.getTime() + SPREADSHEET_TIMEZONE_OFFSET_MS);
	const pad = (n) => String(n).padStart(2, '0');
	return taipei.getUTCFullYear() + '-' + pad(taipei.getUTCMonth() + 1) + '-' + pad(taipei.getUTCDate());
}

// 把台北當地時間的「HH:MM」格式化出來，給時段選擇按鈕顯示用
export function toTaipeiTimeString(date) {
	const taipei = new Date(date.getTime() + SPREADSHEET_TIMEZONE_OFFSET_MS);
	const pad = (n) => String(n).padStart(2, '0');
	return pad(taipei.getUTCHours()) + ':' + pad(taipei.getUTCMinutes());
}

// 把「YYYY-MM-DD」+「HH:MM」組成 Sheets 寫入用的「YYYY-MM-DD HH:MM:SS」格式（USER_ENTERED 才能可靠辨識成日期時間值）
export function toSheetsDateTimeString(date) {
	const taipei = new Date(date.getTime() + SPREADSHEET_TIMEZONE_OFFSET_MS);
	const pad = (n) => String(n).padStart(2, '0');
	return taipei.getUTCFullYear() + '-' + pad(taipei.getUTCMonth() + 1) + '-' + pad(taipei.getUTCDate()) +
		' ' + pad(taipei.getUTCHours()) + ':' + pad(taipei.getUTCMinutes()) + ':' + pad(taipei.getUTCSeconds());
}
