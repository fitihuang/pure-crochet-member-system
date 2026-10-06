import { getGradeById, getGradeIdByName } from './grades.js';
import { findEventById } from './events.js';
import { pushMessageToAdmin, pushMessageToUser } from './lineMessaging.js';

export async function getMemberProfile(sheets, auth) {
	const member = await findMemberByLineUserId(sheets, auth.lineUserId);
	if (!member) {
		// 管理員身分是看 ADMIN_LINE_USER_IDS，跟有沒有綁定會員資料無關，
		// 沒綁定也要能拿到 isAdmin，不然管理員在還沒綁定會員時會被擋在後台外
		return { needBinding: true, isAdmin: auth.isAdmin };
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

// 全新的人（連既有會員資料都沒有）自己填資料申請加入，直接建立正式會員資料，
// LINE userId 這時就先綁上去（本來就是這個人自己登入送出的），送出後馬上能用會員功能
export async function applyForMembership(sheets, env, auth, memberData) {
	const existing = await findMemberByLineUserId(sheets, auth.lineUserId);
	if (existing) throw new Error('你已經是會員了，請勿重複申請');

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
		加入日期: new Date().toISOString().slice(0, 10)
	});

	await pushMessageToAdmin(env, '🆕 新會員加入\n姓名：' + memberData['姓名'] +
		(memberData['手機'] ? '\n手機：' + memberData['手機'] : '') +
		(memberData['Email'] ? '\nEmail：' + memberData['Email'] : ''));
	return { success: true };
}

export async function getAllMembers(sheets, auth) {
	if (!auth.isAdmin) throw new Error('沒有權限');
	return sheets.getSheetAsObjects('Members');
}

// LINE 單則文字訊息上限 5000 字；一次發送人數另設上限，避免單次請求跑太久或超過 Workers 的子請求數量限制
const MAX_MESSAGE_LENGTH = 5000;
const MAX_MESSAGE_RECIPIENTS = 100;

// 後台手動傳訊息給指定會員。推播發出去收不回來，所以每人都是單獨一次 push（不用 broadcast/multicast），
// 單一會員失敗不影響其他人，失敗原因彙整回傳讓管理員知道誰沒收到
export async function sendMessageToMembers(sheets, env, auth, memberIds, text) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	if (!Array.isArray(memberIds) || memberIds.length === 0) throw new Error('請選擇收件人');
	const uniqueMemberIds = [...new Set(memberIds)];
	if (uniqueMemberIds.length > MAX_MESSAGE_RECIPIENTS) {
		throw new Error('一次最多只能傳給 ' + MAX_MESSAGE_RECIPIENTS + ' 位會員');
	}

	const messageText = typeof text === 'string' ? text.trim() : '';
	if (!messageText) throw new Error('訊息內容不能是空白');
	if (messageText.length > MAX_MESSAGE_LENGTH) {
		throw new Error('訊息太長，上限 ' + MAX_MESSAGE_LENGTH + ' 字（目前 ' + messageText.length + ' 字）');
	}

	const members = await sheets.getSheetAsObjects('Members');
	let successCount = 0;
	const failures = [];

	for (const memberId of uniqueMemberIds) {
		const member = members.find((m) => m['會員ID'] === memberId);
		if (!member) {
			failures.push({ 姓名: memberId, 原因: '找不到會員資料' });
			continue;
		}
		if (!member['LINE userId']) {
			failures.push({ 姓名: member['姓名'], 原因: '尚未綁定 LINE' });
			continue;
		}
		try {
			const delivered = await pushMessageToUser(env, member['LINE userId'], messageText);
			if (delivered) {
				successCount++;
			} else {
				failures.push({ 姓名: member['姓名'], 原因: 'LINE 拒絕送出（可能尚未加官方帳號好友或已封鎖）' });
			}
		} catch (err) {
			failures.push({ 姓名: member['姓名'], 原因: err.message });
		}
	}

	return { 成功人數: successCount, 失敗清單: failures };
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

// 金牌會員在「金牌會員期間」報名的付費活動累積滿3筆，自動升等榮譽會員；
// 用「報名時等級snapshot」而不是累積付費活動次數，才不會把當一般會員時期繳的費也算進去。
// 只處理「金牌→榮譽」這個單一方向，其他等級異動仍然全部人工決定，不會互相影響
export async function checkHonorMemberUpgrades(sheets) {
	const vipGradeId = await getGradeIdByName(sheets, '金牌會員');
	const honorGradeId = await getGradeIdByName(sheets, '榮譽會員');
	if (!vipGradeId || !honorGradeId) return;

	const members = await sheets.getSheetAsObjects('Members');
	const registrations = await sheets.getSheetAsObjects('Registrations');

	for (const member of members) {
		if (member['會員等級ID'] !== vipGradeId) continue;

		const qualifyingCount = registrations.filter((r) =>
			r['會員ID'] === member['會員ID'] && r['報名時等級snapshot'] === vipGradeId && r['是否付費'] === '是'
		).length;

		if (qualifyingCount >= 3) {
			await sheets.updateRowFromObject('Members', member._rowNumber, { 會員等級ID: honorGradeId });
		}
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
