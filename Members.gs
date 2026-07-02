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
		coupons: getMemberCoupons(member['會員ID']),
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

	if (!matched) {
		return { success: false, error: '找不到符合的會員資料' };
	}

	var lineUserIdColumn = getColumnIndexByHeader('Members', 'LINE userId');
	getSheet('Members').getRange(matched._rowNumber, lineUserIdColumn).setValue(auth.lineUserId);
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
function checkAllMembersUpgrade(idToken) {
	var auth = verifyLineToken(idToken);
	if (!auth.isAdmin) throw new Error('沒有權限');
	runMemberUpgradeCheck();
	return { success: true };
}

function runMemberUpgradeCheck() {
	var sheet = getSheet('Members');
	var members = getSheetAsObjects('Members');
	var gradeColumn = getColumnIndexByHeader('Members', '會員等級ID');
	var paidCountColumn = getColumnIndexByHeader('Members', '累積付費活動次數');

	members.forEach(function (member) {
		var paidCount = countPaidRegistrations(member['會員ID']);
		sheet.getRange(member._rowNumber, paidCountColumn).setValue(paidCount);

		var newGrade = determineGradeByPaidCount(paidCount);
		if (newGrade && newGrade['會員等級ID'] !== member['會員等級ID']) {
			sheet.getRange(member._rowNumber, gradeColumn).setValue(newGrade['會員等級ID']);
		}
	});
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
			return r;
		});
}

function getMemberCoupons(memberId) {
	return getSheetAsObjects('Coupons').filter(function (c) { return c['會員ID'] === memberId; });
}

function getMemberPurchases(memberId) {
	return getSheetAsObjects('Purchases').filter(function (p) { return p['會員ID'] === memberId; });
}
