import { getGradeById } from './grades.js';
import { findEventById } from './events.js';
import { pushMessageToAdmin } from './lineMessaging.js';

export async function getMemberProfile(sheets, auth) {
	const member = await findMemberByLineUserId(sheets, auth.lineUserId);
	if (!member) {
		// 管理員身分是看 ADMIN_LINE_USER_IDS，跟有沒有綁定會員資料無關，
		// 沒綁定也要能拿到 isAdmin，不然管理員在還沒綁定會員時會被擋在後台外
		return { needBinding: true, isAdmin: auth.isAdmin };
	}

	// 自助申請的新會員在負責人審核通過前，先卡在這個畫面，看不到完整會員資料
	if (member['審核狀態'] === '待審核') {
		return { pendingReview: true, isAdmin: auth.isAdmin };
	}

	const profile = {
		memberId: member['會員ID'],
		name: member['姓名'],
		email: member['Email'],
		phone: member['手機'],
		paidCount: member['累積付費活動次數'],
		grade: await getGradeById(sheets, member['會員等級ID']),
		registrations: await getMemberRegistrations(sheets, member['會員ID']),
		purchases: await getMemberPurchases(sheets, member['會員ID'])
	};
	if (auth.isAdmin) {
		profile.isAdmin = true;
	}
	return profile;
}

export async function findMemberById(sheets, memberId) {
	const members = await sheets.getSheetAsObjects('Members');
	return members.find((m) => m['會員ID'] === memberId) || null;
}

export async function findMemberByLineUserId(sheets, lineUserId) {
	const members = await sheets.getSheetAsObjects('Members');
	return members.find((m) => m['LINE userId'] === lineUserId) || null;
}

// 既有會員首次登入，用手機或 Email 擇一核對成功後把 LINE userId 寫回該列
export async function bindLineUserId(sheets, auth, phoneOrEmail) {
	const members = await sheets.getSheetAsObjects('Members');
	const matched = members.find((m) => m['手機'] === phoneOrEmail || m['Email'] === phoneOrEmail);

	// 「查無資料」跟「已經被綁過」用同一句錯誤訊息，不能讓人靠錯誤訊息去猜別人的手機/Email 存不存在，
	// 也不能讓已綁定的會員被其他人用同一組手機/Email 蓋掉綁定
	const genericError = '找不到符合的會員資料，或該會員已完成綁定，請聯繫負責人確認';
	if (!matched || matched['LINE userId']) {
		return { success: false, error: genericError };
	}

	await sheets.updateRowFromObject('Members', matched._rowNumber, { 'LINE userId': auth.lineUserId });
	return { success: true };
}

// 全新的人（連既有會員資料都沒有）自己填資料申請加入，先建一筆「待審核」的會員資料，
// LINE userId 這時就先綁上去（本來就是這個人自己登入送出的），審核通過前只會看到審核中畫面
export async function applyForMembership(sheets, env, auth, memberData) {
	const existing = await findMemberByLineUserId(sheets, auth.lineUserId);
	if (existing) throw new Error('你已經是會員了，或申請正在審核中，請勿重複申請');

	if (!memberData['姓名'] || !(memberData['手機'] || memberData['Email'])) {
		throw new Error('請填寫姓名，並至少填寫手機或 Email 其中一項');
	}

	const memberId = await sheets.generateNextId('Members', '會員ID', 'M', 4);
	await sheets.appendRowFromObject('Members', {
		會員ID: memberId,
		'LINE userId': auth.lineUserId,
		姓名: memberData['姓名'],
		Email: memberData['Email'] || '',
		手機: memberData['手機'] || '',
		累積付費活動次數: 0,
		加入日期: new Date().toISOString().slice(0, 10),
		審核狀態: '待審核'
	});

	await pushMessageToAdmin(env, '🆕 新會員申請待審核\n姓名：' + memberData['姓名'] +
		(memberData['手機'] ? '\n手機：' + memberData['手機'] : '') +
		(memberData['Email'] ? '\nEmail：' + memberData['Email'] : ''));
	return { success: true };
}

// 拒絕申請就直接刪掉這筆待審核資料，不留「已拒絕」狀態，之後這個人還是可以重新申請一次；
// 限定只能刪「待審核」的資料，避免這個入口被誤用來刪掉正常會員（那會留下報名/預約等孤兒資料）
export async function rejectMemberApplication(sheets, auth, memberId) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const member = await findMemberById(sheets, memberId);
	if (!member) throw new Error('找不到申請資料');
	if (member['審核狀態'] !== '待審核') throw new Error('這筆不是待審核中的申請');

	await sheets.deleteRow('Members', member._rowNumber);
	return { success: true };
}

export async function getAllMembers(sheets, auth) {
	if (!auth.isAdmin) throw new Error('沒有權限');
	return sheets.getSheetAsObjects('Members');
}

export async function createMember(sheets, auth, memberData) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const memberId = await sheets.generateNextId('Members', '會員ID', 'M', 4);
	await sheets.appendRowFromObject('Members', Object.assign({
		會員ID: memberId,
		累積付費活動次數: 0,
		加入日期: new Date().toISOString().slice(0, 10)
	}, memberData));
	return { success: true, memberId };
}

export async function updateMember(sheets, auth, memberId, memberData) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const member = await findMemberById(sheets, memberId);
	if (!member) throw new Error('找不到會員資料');
	await sheets.updateRowFromObject('Members', member._rowNumber, memberData);
	return { success: true };
}

// admin.html 手動按鈕呼叫的入口，需要驗證身份；Cron Trigger 排程請直接呼叫 runMemberUpgradeCheck
export async function checkAllMembersUpgrade(sheets, auth) {
	if (!auth.isAdmin) throw new Error('沒有權限');
	await runMemberUpgradeCheck(sheets);
	return { success: true };
}

// 會員等級改由管理者手動指定，這支只負責重新統計付費次數，不會再自動改等級
export async function runMemberUpgradeCheck(sheets) {
	const members = await sheets.getSheetAsObjects('Members');
	for (const member of members) {
		const paidCount = await countPaidRegistrations(sheets, member['會員ID']);
		await sheets.updateRowFromObject('Members', member._rowNumber, { 累積付費活動次數: paidCount });
	}
}

async function countPaidRegistrations(sheets, memberId) {
	const registrations = await sheets.getSheetAsObjects('Registrations');
	return registrations.filter((r) => r['會員ID'] === memberId && r['是否付費'] === '是').length;
}

async function getMemberRegistrations(sheets, memberId) {
	const registrations = await sheets.getSheetAsObjects('Registrations');
	const mine = registrations.filter((r) => r['會員ID'] === memberId);

	const decorated = await Promise.all(mine.map(async (r) => {
		const event = await findEventById(sheets, r['活動ID']);
		r['活動名稱'] = event ? event['活動名稱'] : r['活動ID'];
		r['活動日期'] = event ? event['活動日期'] : null;
		return r;
	}));

	return decorated.sort((a, b) => new Date(b['活動日期']) - new Date(a['活動日期']));
}

async function getMemberPurchases(sheets, memberId) {
	const purchases = await sheets.getSheetAsObjects('Purchases');
	return purchases.filter((p) => p['會員ID'] === memberId);
}
