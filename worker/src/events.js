import { getGradeIdByName } from './grades.js';
import { todayAtMidnight, toTaipeiDateString } from './dateUtils.js';
import { deleteImageFromR2 } from './imageUpload.js';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from './calendar.js';

// 把活動資料組成 Calendar 事件的時間欄位：有開始時間就建時段事件（沒結束時間預設抓 2 小時），
// 完全沒時間就建全天事件，方便負責人在日曆上一眼看到當天有活動。
// 活動日期可能是後台表單剛送出的純 'YYYY-MM-DD'，也可能是從 Sheet 讀回來、已經轉成完整 ISO 的日期時間字串
// （updateEvent 會把既有列跟新資料合併），兩種都要用 toTaipeiDateString 統一轉成乾淨的 'YYYY-MM-DD' 再組時間
function buildEventCalendarPayload(eventData) {
	const dateStr = toTaipeiDateString(new Date(eventData['活動日期']));
	const startTime = eventData['開始時間'];
	const endTime = eventData['結束時間'];
	const summary = '【活動】' + (eventData['活動名稱'] || '');
	const description = eventData['活動地點'] ? '地點：' + eventData['活動地點'] : '';

	if (!startTime) {
		// 全天事件的結束日期要用純日曆算術往後推一天（Calendar 慣例是不含結束日），
		// 不能用真實時間往後加 24 小時再取 UTC 日期，那樣會因為時區位移對不齊，算出跟開始日期同一天
		const endDateOnly = new Date(dateStr + 'T00:00:00Z');
		endDateOnly.setUTCDate(endDateOnly.getUTCDate() + 1);
		return { summary, description, startDate: dateStr, endDate: endDateOnly.toISOString().slice(0, 10) };
	}

	const startISO = dateStr + 'T' + startTime + ':00+08:00';
	const endISO = endTime
		? dateStr + 'T' + endTime + ':00+08:00'
		: new Date(new Date(startISO).getTime() + 2 * 3600000).toISOString();
	return { summary, description, startISO, endISO };
}

// Calendar 同步失敗不該擋掉活動本身的新增/修改/刪除，這純粹是給負責人自己在日曆上參考用的附加功能
async function syncCreateToCalendar(env, eventData) {
	try {
		return await createCalendarEvent(env, buildEventCalendarPayload(eventData));
	} catch (err) {
		console.log('活動同步到 Calendar 失敗：', err.message);
		return '';
	}
}

async function syncUpdateToCalendar(env, calendarEventId, eventData) {
	try {
		await updateCalendarEvent(env, calendarEventId, buildEventCalendarPayload(eventData));
	} catch (err) {
		console.log('活動同步到 Calendar 失敗：', err.message);
	}
}

async function syncDeleteFromCalendar(env, calendarEventId) {
	try {
		await deleteCalendarEvent(env, calendarEventId);
	} catch (err) {
		console.log('活動從 Calendar 刪除失敗：', err.message);
	}
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

export async function createEvent(sheets, env, auth, eventData) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const eventId = await sheets.generateNextId('Events', '活動ID', 'E', 4);
	const calendarEventId = await syncCreateToCalendar(env, eventData);
	const data = Object.assign({ 活動ID: eventId, 狀態: '開放報名', GoogleCalendar事件ID: calendarEventId }, eventData);
	await sheets.appendRowFromObject('Events', data);
	return { success: true, eventId };
}

export async function updateEvent(sheets, env, auth, eventId, eventData) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const event = await findEventById(sheets, eventId);
	if (!event) throw new Error('找不到該活動');

	const oldImageUrl = event['活動封面圖片網址'];
	const newImageUrl = eventData['活動封面圖片網址'];

	// 舊活動可能還沒有 Calendar 事件（這個功能上線前建立的），修改時順便補建
	const merged = Object.assign({}, event, eventData);
	if (event['GoogleCalendar事件ID']) {
		await syncUpdateToCalendar(env, event['GoogleCalendar事件ID'], merged);
	} else {
		const calendarEventId = await syncCreateToCalendar(env, merged);
		if (calendarEventId) eventData = Object.assign({}, eventData, { GoogleCalendar事件ID: calendarEventId });
	}

	await sheets.updateRowFromObject('Events', event._rowNumber, eventData);

	// 換封面圖時把舊圖從 R2 刪掉，避免免費額度被換掉不用的圖片慢慢吃掉；
	// eventData 沒帶這個欄位就代表這次更新沒有要動圖片，不能誤判成「換成空圖」而把舊圖刪掉
	if (oldImageUrl && newImageUrl !== undefined && newImageUrl !== oldImageUrl) {
		await deleteImageFromR2(env, oldImageUrl);
	}

	return { success: true };
}

// 已經有報名紀錄的活動不能刪，避免連帶把報名/繳費歷史一起弄丟；這種情況請改把狀態設為已截止
export async function deleteEvent(sheets, env, auth, eventId) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const event = await findEventById(sheets, eventId);
	if (!event) throw new Error('找不到該活動');

	const registrations = (await sheets.getSheetAsObjects('Registrations')).filter((r) => r['活動ID'] === eventId);
	if (registrations.length > 0) {
		throw new Error('這個活動已經有報名紀錄，無法刪除，可以改把狀態設為已截止');
	}

	await sheets.deleteRow('Events', event._rowNumber);
	if (event['活動封面圖片網址']) {
		await deleteImageFromR2(env, event['活動封面圖片網址']);
	}
	if (event['GoogleCalendar事件ID']) {
		await syncDeleteFromCalendar(env, event['GoogleCalendar事件ID']);
	}
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
