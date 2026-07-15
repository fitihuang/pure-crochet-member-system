// Settings 分頁是「設定項目」/「內容」兩欄的通用鍵值表，之後有其他要讓負責人自己編輯的文字都可以往這裡加，
// 不用每加一種設定就多開一支 API。這支會被 loadProfile 的 Promise.all 一起打，
// Settings 分頁還沒建立時要回傳空物件，不能整個丟出去害整頁掛掉
function getSettings() {
	if (!getSheet('Settings')) {
		return {};
	}
	var settings = {};
	getSheetAsObjects('Settings').forEach(function (row) {
		settings[row['設定項目']] = row['內容'];
	});
	return settings;
}
