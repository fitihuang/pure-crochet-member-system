// Settings 分頁是「設定項目」/「內容」兩欄的通用鍵值表，之後有其他要讓負責人自己編輯的文字都可以往這裡加，
// 不用每加一種設定就多開一支 API
function getSettings() {
	var settings = {};
	getSheetAsObjects('Settings').forEach(function (row) {
		settings[row['設定項目']] = row['內容'];
	});
	return settings;
}
