function monthlyIssueCoupons() {
	var vipGradeId = getGradeIdByName('金牌會員');
	var vipMembers = getSheetAsObjects('Members').filter(function (member) {
		return member['會員等級ID'] === vipGradeId;
	});

	vipMembers.forEach(function (member) {
		issueCouponToMember(member['會員ID']);
	});
}

function issueCouponToMember(memberId) {
	var issueDate = todayAtMidnight();
	var expireDate = new Date(issueDate);
	expireDate.setDate(expireDate.getDate() + 30);
	var issueMonth = Utilities.formatDate(issueDate, 'Asia/Taipei', 'yyyy-MM');
	var couponId = generateNextId('Coupons', '優惠券ID', 'C', 4);

	getSheet('Coupons').appendRow([couponId, memberId, issueMonth, issueDate, expireDate, 200, '生效中', '']);
}

function redeemCoupon(idToken, couponId, registrationId) {
	var auth = verifyLineToken(idToken);
	var member = findMemberByLineUserId(auth.lineUserId);
	if (!member) throw new Error('找不到會員資料');

	var coupon = getSheetAsObjects('Coupons').filter(function (c) { return c['優惠券ID'] === couponId; })[0];
	if (!coupon) throw new Error('找不到這張優惠券');
	if (coupon['會員ID'] !== member['會員ID']) throw new Error('這張優惠券不屬於你');
	if (coupon['狀態'] !== '生效中') throw new Error('這張優惠券無法使用（' + coupon['狀態'] + '）');

	var statusColumn = getColumnIndexByHeader('Coupons', '狀態');
	var usedInColumn = getColumnIndexByHeader('Coupons', '使用於哪筆報名');
	var sheet = getSheet('Coupons');
	sheet.getRange(coupon._rowNumber, statusColumn).setValue('已使用');
	sheet.getRange(coupon._rowNumber, usedInColumn).setValue(registrationId);

	return { success: true };
}

// 每日排程掃描，把過期但還顯示「生效中」的優惠券改成「已過期」
function updateExpiredCoupons() {
	var sheet = getSheet('Coupons');
	var statusColumn = getColumnIndexByHeader('Coupons', '狀態');
	var today = todayAtMidnight();

	getSheetAsObjects('Coupons').forEach(function (coupon) {
		if (coupon['狀態'] === '生效中' && new Date(coupon['到期日']) < today) {
			sheet.getRange(coupon._rowNumber, statusColumn).setValue('已過期');
		}
	});
}
