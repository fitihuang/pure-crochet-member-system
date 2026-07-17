import { findMemberByLineUserId, findMemberById } from './members.js';
import { findEventById, getEventPriceForGrade } from './events.js';
import { getGradeById, getGradeIdByName } from './grades.js';
import { todayAtMidnight } from './dateUtils.js';

// 寫進 Sheet 的「現在時間」用台北當地時間的文字格式，讓 Sheets 的 USER_ENTERED 能可靠辨識成日期時間值
function nowAsTaipeiDateTimeString() {
	const taipeiMs = Date.now() + 8 * 3600000;
	const d = new Date(taipeiMs);
	const pad = (n) => String(n).padStart(2, '0');
	return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
		' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}

export async function submitRegistration(sheets, auth, eventId) {
	const member = await findMemberByLineUserId(sheets, auth.lineUserId);
	if (!member) throw new Error('找不到會員資料，請先完成帳號綁定');
	return runSubmitRegistration(sheets, member['會員ID'], eventId);
}

export async function runSubmitRegistration(sheets, memberId, eventId) {
	const member = await findMemberById(sheets, memberId);
	if (!member) throw new Error('找不到會員資料');

	const event = await findEventById(sheets, eventId);
	if (!event) throw new Error('找不到該活動');

	if (await hasAlreadyRegistered(sheets, memberId, eventId)) {
		throw new Error('已經報名過這場活動了');
	}
	if (isRegistrationClosed(event)) {
		throw new Error('已經超過報名截止日');
	}

	const gradeId = member['會員等級ID'];
	await assertQuotaAvailable(sheets, event, gradeId);
	const price = await getEventPriceForGrade(sheets, event, gradeId);

	// 報名當下先預設「否」，是否已實際收款由負責人之後手動在 Sheet 上確認標註
	const registrationId = await sheets.generateNextId('Registrations', '報名ID', 'R', 4);
	await sheets.appendRowFromObject('Registrations', {
		報名ID: registrationId,
		會員ID: memberId,
		活動ID: eventId,
		報名時間: nowAsTaipeiDateTimeString(),
		// 「報名時等級snapshot」跟「佔用名額類別」存同一個等級ID，分開兩欄是為了保留歷史紀錄跟名額歸屬各自的意義
		報名時等級snapshot: gradeId,
		佔用名額類別: gradeId,
		是否付費: '否',
		金額: price
	});

	if (event['是否付費'] === '是') {
		const purchaseId = await sheets.generateNextId('Purchases', '消費ID', 'P', 4);
		await sheets.appendRowFromObject('Purchases', {
			消費ID: purchaseId,
			會員ID: memberId,
			消費日期: nowAsTaipeiDateTimeString(),
			項目: event['活動名稱'],
			金額: price,
			關聯報名ID: registrationId
		});
	}

	return { success: true, registrationId };
}

async function hasAlreadyRegistered(sheets, memberId, eventId) {
	const registrations = await sheets.getSheetAsObjects('Registrations');
	return registrations.some((r) => r['會員ID'] === memberId && r['活動ID'] === eventId);
}

function isRegistrationClosed(event) {
	return todayAtMidnight() > new Date(event['報名截止日']);
}

async function assertQuotaAvailable(sheets, event, gradeId) {
	const vipGradeId = await getGradeIdByName(sheets, '金牌會員');
	const quotaField = gradeId === vipGradeId ? 'VIP保留名額' : '一般名額';
	const registrations = await sheets.getSheetAsObjects('Registrations');
	const usedCount = registrations.filter((r) => r['活動ID'] === event['活動ID'] && r['佔用名額類別'] === gradeId).length;

	if (usedCount >= event[quotaField]) {
		throw new Error('該類別名額已滿');
	}
}

export async function getEventRegistrationsForAdmin(sheets, auth, eventId) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const registrations = (await sheets.getSheetAsObjects('Registrations')).filter((r) => r['活動ID'] === eventId);
	return Promise.all(registrations.map(async (r) => {
		const member = await findMemberById(sheets, r['會員ID']);
		r['會員姓名'] = member ? member['姓名'] : r['會員ID'];
		const grade = await getGradeById(sheets, r['佔用名額類別']);
		r['佔用名額類別名稱'] = grade ? grade['會員等級名稱'] : r['佔用名額類別'];
		return r;
	}));
}

export async function updateRegistrationPayment(sheets, auth, registrationId, isPaid) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const registrations = await sheets.getSheetAsObjects('Registrations');
	const registration = registrations.find((r) => r['報名ID'] === registrationId);
	if (!registration) throw new Error('找不到報名紀錄');

	await sheets.updateRowFromObject('Registrations', registration._rowNumber, { 是否付費: isPaid ? '是' : '否' });
	return { success: true };
}
