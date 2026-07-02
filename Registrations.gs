// Admin/前端呼叫的入口，需要 LINE 登入驗證；測試時請直接呼叫 runSubmitRegistration
function submitRegistration(idToken, eventId) {
	var auth = verifyLineToken(idToken);
	var member = findMemberByLineUserId(auth.lineUserId);
	if (!member) throw new Error('找不到會員資料，請先完成帳號綁定');
	return runSubmitRegistration(member['會員ID'], eventId);
}

function runSubmitRegistration(memberId, eventId) {
	var member = findMemberById(memberId);
	if (!member) throw new Error('找不到會員資料');

	var event = findEventById(eventId);
	if (!event) throw new Error('找不到該活動');

	if (hasAlreadyRegistered(memberId, eventId)) {
		throw new Error('已經報名過這場活動了');
	}
	if (isRegistrationClosed(event)) {
		throw new Error('已經超過報名截止日');
	}

	var gradeId = member['會員等級ID'];
	assertQuotaAvailable(event, gradeId);

	var registrationId = generateNextId('Registrations', '報名ID', 'R', 4);
	appendRegistrationRow(registrationId, memberId, eventId, gradeId, event['是否付費'], event['費用']);

	if (event['是否付費'] === '是') {
		var purchaseId = generateNextId('Purchases', '消費ID', 'P', 4);
		appendPurchaseRow(purchaseId, memberId, event['活動名稱'], event['費用'], registrationId);
	}

	return { success: true, registrationId: registrationId };
}

function hasAlreadyRegistered(memberId, eventId) {
	return getSheetAsObjects('Registrations').some(function (r) {
		return r['會員ID'] === memberId && r['活動ID'] === eventId;
	});
}

function isRegistrationClosed(event) {
	return todayAtMidnight() > new Date(event['報名截止日']);
}

function assertQuotaAvailable(event, gradeId) {
	var vipGradeId = getGradeIdByName('金牌會員');
	var quotaField = (gradeId === vipGradeId) ? 'VIP保留名額' : '一般名額';
	var usedCount = getSheetAsObjects('Registrations').filter(function (r) {
		return r['活動ID'] === event['活動ID'] && r['佔用名額類別'] === gradeId;
	}).length;

	if (usedCount >= event[quotaField]) {
		throw new Error('該類別名額已滿');
	}
}

function appendRegistrationRow(registrationId, memberId, eventId, gradeId, isPaid, amount) {
	// 「報名時等級snapshot」跟「佔用名額類別」目前存的是同一個等級ID，
	// 分開兩欄是為了保留歷史紀錄跟名額歸屬各自的意義，之後等級規則變複雜時才不用大改
	getSheet('Registrations').appendRow(
		[registrationId, memberId, eventId, new Date(), gradeId, gradeId, isPaid, amount, '']
	);
}

function appendPurchaseRow(purchaseId, memberId, item, amount, registrationId) {
	getSheet('Purchases').appendRow([purchaseId, memberId, new Date(), item, amount, registrationId]);
}
