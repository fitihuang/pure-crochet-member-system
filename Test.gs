// 這些測試函式不需要 LINE 登入就能跑，用來快速確認資料表欄位讀取正常
// 確認沒問題之後可以整支刪掉，不影響正式邏輯

function testReadMembers() {
	Logger.log(JSON.stringify(getSheetAsObjects('Members'), null, 2));
}

function testReadEvents() {
	Logger.log(JSON.stringify(getSheetAsObjects('Events'), null, 2));
}

function testReadGrades() {
	Logger.log(JSON.stringify(getSheetAsObjects('Grade'), null, 2));
}

function testGetEventList() {
	Logger.log(JSON.stringify(getEventList(), null, 2));
}

function testDetermineGrade() {
	Logger.log('付費0次 -> ' + JSON.stringify(determineGradeByPaidCount(0)));
	Logger.log('付費3次 -> ' + JSON.stringify(determineGradeByPaidCount(3)));
	Logger.log('付費5次 -> ' + JSON.stringify(determineGradeByPaidCount(5)));
}

// 用 M0001 報名 E0001，跳過 LINE 登入驗證，直接測報名的核心邏輯
function testSubmitRegistration() {
	Logger.log(JSON.stringify(runSubmitRegistration('M0001', 'E0001')));
}

function testRunMemberUpgradeCheck() {
	runMemberUpgradeCheck();
	Logger.log(JSON.stringify(getSheetAsObjects('Members'), null, 2));
}
