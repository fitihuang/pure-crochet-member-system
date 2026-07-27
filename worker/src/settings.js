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

// settingsData 是 { 設定項目: 內容 } 的物件，項目已存在就更新，不存在就新增一列
export async function updateSettings(sheets, auth, settingsData) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const rows = await sheets.getSheetAsObjects('Settings');
	for (const [key, value] of Object.entries(settingsData)) {
		const row = rows.find((r) => r['設定項目'] === key);
		if (row) {
			await sheets.updateRowFromObject('Settings', row._rowNumber, { 內容: value });
		} else {
			await sheets.appendRowFromObject('Settings', { 設定項目: key, 內容: value });
		}
	}
	return { success: true };
}
