import { findMemberByLineUserId, findMemberById } from './members.js';
import { findEventById, getEventPriceForGrade } from './events.js';
import { getGradeById, getGradeIdByName } from './grades.js';
import { todayAtMidnight, toSheetsDateTimeString, toTaipeiDateString } from './dateUtils.js';
import { pushMessageToUser } from './lineMessaging.js';

function nowAsTaipeiDateTimeString() {
	return toSheetsDateTimeString(new Date());
}

export async function submitRegistration(sheets, env, auth, eventId, customFieldAnswers) {
	const member = await findMemberByLineUserId(sheets, auth.lineUserId);
	if (!member) throw new Error('找不到會員資料，請先完成帳號綁定');
	return runSubmitRegistration(sheets, env, member['會員ID'], eventId, customFieldAnswers);
}

export async function runSubmitRegistration(sheets, env, memberId, eventId, customFieldAnswers) {
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
	// 應繳金額 = 活動基本費用 + 自訂欄位裡有設定加價的選項；一律用活動當下的欄位設定重算，不相信前端傳來的金額，避免被竄改
	const basePrice = await getEventPriceForGrade(sheets, event, gradeId);
	const addonPrice = calculateCustomFieldsAddonPrice(event, customFieldAnswers);
	const price = basePrice + addonPrice;

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
		金額: price,
		// 活動如果有設定自訂報名欄位（下拉選單/checkbox/留言），答案存成 JSON 字串；沒填就存空字串
		自訂欄位回覆: customFieldAnswers && Object.keys(customFieldAnswers).length > 0 ? JSON.stringify(customFieldAnswers) : '',
		已提醒: '否'
	});

	// 用實際算出來的總額判斷要不要留消費紀錄，不能只看活動本身是否付費——
	// 免費活動如果自訂欄位選了會加價的選項，一樣要收錢、要留紀錄
	if (price > 0) {
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

	// 報名成功主動通知會員本人，跟 Calendar／管理員推播一樣走 fault-tolerant 模式，失敗不能擋掉報名結果
	try {
		await pushMessageToUser(env, member['LINE userId'],
			'✅ 報名成功通知\n活動：' + event['活動名稱'] +
			'\n日期：' + toTaipeiDateString(new Date(event['活動日期'])) +
			(price > 0 ? '\n應繳金額：' + price : ''));
	} catch (err) {
		console.log('報名成功通知推播失敗：', err.message);
	}

	return { success: true, registrationId };
}

// 活動的「自訂欄位設定」JSON 裡每個選項可以帶 price，依報名者實際選的答案加總出加購金額；
// 格式壞掉、欄位對不上、選項對不上都當作沒有加價，不能讓解析失敗擋住整個報名流程
function calculateCustomFieldsAddonPrice(event, customFieldAnswers) {
	if (!customFieldAnswers) return 0;

	let fields;
	try {
		fields = JSON.parse(event['自訂欄位設定'] || '[]');
	} catch (e) {
		return 0;
	}
	if (!Array.isArray(fields)) return 0;

	let addon = 0;
	for (const field of fields) {
		const answer = customFieldAnswers[field.label];
		if (answer === undefined) continue;

		const options = field.options || [];
		const selectedLabels = Array.isArray(answer) ? answer : [answer];
		for (const selectedLabel of selectedLabels) {
			const option = options.find((o) => o.label === selectedLabel);
			if (option && option.price) addon += Number(option.price) || 0;
		}
	}
	return addon;
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

// 給 scheduled cron 呼叫：檢查明天要舉行、還沒提醒過的活動，推播提醒給每一位已報名的會員
export async function sendUpcomingEventReminders(sheets, env) {
	const tomorrow = new Date(todayAtMidnight().getTime() + 86400000);
	const tomorrowDateStr = toTaipeiDateString(tomorrow);

	const events = await sheets.getSheetAsObjects('Events');
	const upcomingEvents = events.filter((e) => e['活動日期'] && toTaipeiDateString(new Date(e['活動日期'])) === tomorrowDateStr);
	if (upcomingEvents.length === 0) return;

	const registrations = await sheets.getSheetAsObjects('Registrations');
	for (const event of upcomingEvents) {
		const due = registrations.filter((r) => r['活動ID'] === event['活動ID'] && r['已提醒'] !== '是');
		for (const registration of due) {
			const member = await findMemberById(sheets, registration['會員ID']);
			if (member) {
				try {
					await pushMessageToUser(env, member['LINE userId'],
						'⏰ 活動提醒\n活動：' + event['活動名稱'] + '\n時間：明天' +
						(event['開始時間'] ? ' ' + event['開始時間'] : '') +
						(event['活動地點'] ? '\n地點：' + event['活動地點'] : ''));
				} catch (err) {
					console.log('活動提醒推播失敗：', err.message);
				}
			}
			// 不管有沒有找到會員資料都要標記已提醒，避免孤兒報名紀錄每天卡在這裡重複嘗試
			await sheets.updateRowFromObject('Registrations', registration._rowNumber, { 已提醒: '是' });
		}
	}
}

export async function updateRegistrationPayment(sheets, auth, registrationId, isPaid) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const registrations = await sheets.getSheetAsObjects('Registrations');
	const registration = registrations.find((r) => r['報名ID'] === registrationId);
	if (!registration) throw new Error('找不到報名紀錄');

	await sheets.updateRowFromObject('Registrations', registration._rowNumber, { 是否付費: isPaid ? '是' : '否' });
	return { success: true };
}
