function getMemberProfile(idToken) {
	var auth = verifyLineToken(idToken);
	var member = findMemberByLineUserId(auth.lineUserId);
	if (!member) {
		return { needBinding: true };
	}

	var profile = {
		memberId: member['會員ID'],
		name: member['姓名'],
		email: member['Email'],
		phone: member['手機'],
		paidCount: member['累積付費活動次數'],
		grade: getGradeById(member['會員等級ID']),
		registrations: getMemberRegistrations(member['會員ID']),
		purchases: getMemberPurchases(member['會員ID'])
	};
	if (auth.isAdmin) {
		profile.isAdmin = true;
	}
	return profile;
}

function findMemberById(memberId) {
	var members = getSheetAsObjects('Members');
	for (var i = 0; i < members.length; i++) {
		if (members[i]['會員ID'] === memberId) {
			return members[i];
		}
	}
	return null;
}

function findMemberByLineUserId(lineUserId) {
	var members = getSheetAsObjects('Members');
	for (var i = 0; i < members.length; i++) {
		if (members[i]['LINE userId'] === lineUserId) {
			return members[i];
		}
	}
	return null;
}

// 既有會員首次登入，用手機或 Email 擇一核對成功後把 LINE userId 寫回該列
function bindLineUserId(idToken, phoneOrEmail) {
	var auth = verifyLineToken(idToken);
	var members = getSheetAsObjects('Members');
	var matched = members.filter(function (member) {
		return member['手機'] === phoneOrEmail || member['Email'] === phoneOrEmail;
	})[0];

	// 「查無資料」跟「已經被綁過」用同一句錯誤訊息，不能讓人靠錯誤訊息去猜別人的手機/Email 存不存在，
	// 也不能讓已綁定的會員被其他人用同一組手機/Email 蓋掉綁定
	var genericError = '找不到符合的會員資料，或該會員已完成綁定，請聯繫負責人確認';
	if (!matched || matched['LINE userId']) {
		return { success: false, error: genericError };
	}

	var lineUserIdColumn = getColumnIndexByHeader('Members', 'LINE userId');
	getSheet('Members').getRange(matched._rowNumber, lineUserIdColumn).setValue(auth.lineUserId);
	clearSheetCache();
	return { success: true };
}

function getAllMembers(idToken) {
	var auth = verifyLineToken(idToken);
	if (!auth.isAdmin) throw new Error('沒有權限');
	return getSheetAsObjects('Members');
}

function createMember(idToken, memberData) {
	var auth = verifyLineToken(idToken);
	if (!auth.isAdmin) throw new Error('沒有權限');

	var memberId = generateNextId('Members', '會員ID', 'M', 4);
	appendRowFromObject('Members', Object.assign({
		'會員ID': memberId,
		'累積付費活動次數': 0,
		'加入日期': new Date()
	}, memberData));
	return { success: true, memberId: memberId };
}

function updateMember(idToken, memberId, memberData) {
	var auth = verifyLineToken(idToken);
	if (!auth.isAdmin) throw new Error('沒有權限');

	var member = findMemberById(memberId);
	if (!member) throw new Error('找不到會員資料');
	updateRowFromObject('Members', member._rowNumber, memberData);
	return { success: true };
}

// Admin 手動按鈕呼叫的入口，需要驗證身份；定時觸發器請直接呼叫 runMemberUpgradeCheck
// 會員等級改由管理者手動指定（見 updateMember），這支只負責重新統計付費次數，不會再自動改等級
function checkAllMembersUpgrade(idToken) {
	var auth = verifyLineToken(idToken);
	if (!auth.isAdmin) throw new Error('沒有權限');
	runMemberUpgradeCheck();
	return { success: true };
}

function runMemberUpgradeCheck() {
	var sheet = getSheet('Members');
	var members = getSheetAsObjects('Members');
	var paidCountColumn = getColumnIndexByHeader('Members', '累積付費活動次數');

	members.forEach(function (member) {
		var paidCount = countPaidRegistrations(member['會員ID']);
		sheet.getRange(member._rowNumber, paidCountColumn).setValue(paidCount);
	});
	clearSheetCache();
}

function countPaidRegistrations(memberId) {
	return getSheetAsObjects('Registrations').filter(function (registration) {
		return registration['會員ID'] === memberId && registration['是否付費'] === '是';
	}).length;
}

function getMemberRegistrations(memberId) {
	return getSheetAsObjects('Registrations')
		.filter(function (r) { return r['會員ID'] === memberId; })
		.map(function (r) {
			var event = findEventById(r['活動ID']);
			r['活動名稱'] = event ? event['活動名稱'] : r['活動ID'];
			r['活動日期'] = event ? event['活動日期'] : null;
			return r;
		})
		.sort(function (a, b) { return new Date(b['活動日期']) - new Date(a['活動日期']); });
}

function getMemberPurchases(memberId) {
	return getSheetAsObjects('Purchases').filter(function (p) { return p['會員ID'] === memberId; });
}
