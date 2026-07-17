const SPREADSHEET_TIMEZONE_OFFSET_MS = 8 * 3600000; // Asia/Taipei

// 回傳「今天」在台北時區的午夜，用 UTC 表示 —— 不能直接用 UTC 午夜，
// 不然會跟台北時間差 8 小時，把「今天」的活動誤判成已過期
export function todayAtMidnight() {
	const now = new Date();
	const taipeiNow = new Date(now.getTime() + SPREADSHEET_TIMEZONE_OFFSET_MS);
	const taipeiMidnightAsIfUTC = Date.UTC(taipeiNow.getUTCFullYear(), taipeiNow.getUTCMonth(), taipeiNow.getUTCDate());
	return new Date(taipeiMidnightAsIfUTC - SPREADSHEET_TIMEZONE_OFFSET_MS);
}
