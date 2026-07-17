import { getGradeIdByName } from './grades.js';

function todayAtMidnight() {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getEventList(sheets) {
	const today = todayAtMidnight();
	const events = await sheets.getSheetAsObjects('Events');
	const openEvents = events.filter((event) => event['狀態'] === '開放報名' && new Date(event['活動日期']) >= today);
	return Promise.all(openEvents.map((event) => decorateEventWithRemainingQuota(sheets, event)));
}

export async function decorateEventWithRemainingQuota(sheets, event) {
	const vipGradeId = await getGradeIdByName(sheets, '金牌會員');
	const registrations = (await sheets.getSheetAsObjects('Registrations')).filter((r) => r['活動ID'] === event['活動ID']);
	const vipUsed = registrations.filter((r) => r['佔用名額類別'] === vipGradeId).length;
	const generalUsed = registrations.length - vipUsed;

	event['VIP剩餘名額'] = event['VIP保留名額'] - vipUsed;
	event['一般剩餘名額'] = event['一般名額'] - generalUsed;
	return event;
}

export async function getEventDetail(sheets, eventId) {
	const event = await findEventById(sheets, eventId);
	if (!event) throw new Error('找不到該活動');
	return decorateEventWithRemainingQuota(sheets, event);
}

export async function getAllEventsForAdmin(sheets, auth) {
	if (!auth.isAdmin) throw new Error('沒有權限');
	const events = await sheets.getSheetAsObjects('Events');
	return Promise.all(events.map((event) => decorateEventWithRemainingQuota(sheets, event)));
}

export async function createEvent(sheets, auth, eventData) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const eventId = await sheets.generateNextId('Events', '活動ID', 'E', 4);
	const data = Object.assign({ 活動ID: eventId, 狀態: '開放報名' }, eventData);
	await sheets.appendRowFromObject('Events', data);
	return { success: true, eventId };
}

export async function updateEvent(sheets, auth, eventId, eventData) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const event = await findEventById(sheets, eventId);
	if (!event) throw new Error('找不到該活動');

	await sheets.updateRowFromObject('Events', event._rowNumber, eventData);
	return { success: true };
}

// 金牌會員跟一般會員是兩個不同價格欄位，依報名者當下的等級決定要用哪一個
export async function getEventPriceForGrade(sheets, event, gradeId) {
	const vipGradeId = await getGradeIdByName(sheets, '金牌會員');
	return gradeId === vipGradeId ? event['金牌會員費用'] : event['一般會員費用'];
}

export async function findEventById(sheets, eventId) {
	const events = await sheets.getSheetAsObjects('Events');
	return events.find((e) => e['活動ID'] === eventId) || null;
}
