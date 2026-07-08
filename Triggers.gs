// 這支只需要手動執行「一次」來建立時間觸發器，不要重複執行，
// 否則會建立出重複的 trigger
function setupTimeTriggers() {
	ScriptApp.newTrigger('dailyMaintenance')
		.timeBased().everyDays(1).atHour(2).create();
}

function dailyMaintenance() {
	runMemberUpgradeCheck();
}

// 優惠券功能移除後，之前如果已經手動執行過 setupTimeTriggers()，
// 「每月發券」那個觸發器還會留著（指向已經刪掉的函式，跑起來只會失敗）。
// 手動執行這支一次清掉它，清完可以把這支刪掉
function removeMonthlyIssueCouponsTrigger() {
	var triggers = ScriptApp.getProjectTriggers();
	triggers.forEach(function (trigger) {
		if (trigger.getHandlerFunction() === 'monthlyIssueCoupons') {
			ScriptApp.deleteTrigger(trigger);
		}
	});
}
