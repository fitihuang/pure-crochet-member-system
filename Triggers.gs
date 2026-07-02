// 這支只需要手動執行「一次」來建立時間觸發器，不要重複執行，
// 否則會建立出重複的 trigger
function setupTimeTriggers() {
	ScriptApp.newTrigger('monthlyIssueCoupons')
		.timeBased().onMonthDay(1).atHour(9).create();

	ScriptApp.newTrigger('dailyMaintenance')
		.timeBased().everyDays(1).atHour(2).create();
}

function dailyMaintenance() {
	runMemberUpgradeCheck();
	updateExpiredCoupons();
}
