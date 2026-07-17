// Settings 分頁不存在時要回傳空物件而不是丟錯，不然前端會被拖垮（loadProfile 是 Promise.all 一起打的）
export async function getSettings(sheets) {
	if (!(await sheets.sheetExists('Settings'))) {
		return {};
	}
	const rows = await sheets.getSheetAsObjects('Settings');
	const settings = {};
	rows.forEach((row) => {
		settings[row['設定項目']] = row['內容'];
	});
	return settings;
}
