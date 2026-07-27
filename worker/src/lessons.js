import { getSettings } from './settings.js';
import { getBusyTimes, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from './calendar.js';
import { pushMessageToAdmin } from './lineMessaging.js';
import { findMemberByLineUserId, findMemberById } from './members.js';
import { toTaipeiDateString, toTaipeiTimeString, toSheetsDateTimeString } from './dateUtils.js';

function toInt(value, fallback) {
	const n = parseInt(value, 10);
	return isNaN(n) ? fallback : n;
}

async function getLessonSettings(sheets) {
	const settings = await getSettings(sheets);
	return {
		durationMinutes: toInt(settings['一對一課程時長分鐘'], 60),
		bufferMinutes: toInt(settings['一對一緩衝時間分鐘'], 15),
		openTime: settings['一對一預約開放時段起'] || '10:00',
		closeTime: settings['一對一預約開放時段迄'] || '18:00',
		reminderLeadMinutes: toInt(settings['一對一課前提醒分鐘數'], 60),
		lineContactUrl: settings['負責人LINE聊天連結'] || ''
	};
}

// dateStr 是 'YYYY-MM-DD'，timeStr 是 'HH:MM'，組成帶明確時區位移的 ISO 字串，Calendar API 可以直接吃
function buildTaipeiISOString(dateStr, timeStr) {
	return dateStr + 'T' + timeStr + ':00+08:00';
}

function formatForMessage(isoString) {
	return toSheetsDateTimeString(new Date(isoString));
}

async function getMemberLessons(sheets, memberId) {
	const lessons = await sheets.getSheetAsObjects('Lessons');
	return lessons.filter((l) => l['會員ID'] === memberId);
}

// 同一天只要有團體活動（不分狀態），這天就整天不開放一對一預約
async function hasActivityOnDate(sheets, dateStr) {
	const events = await sheets.getSheetAsObjects('Events');
	return events.some((e) => e['活動日期'] && toTaipeiDateString(new Date(e['活動日期'])) === dateStr);
}

export async function getLessonBookingInfo(sheets, auth) {
	const member = await findMemberByLineUserId(sheets, auth.lineUserId);
	if (!member) throw new Error('找不到會員資料，請先完成帳號綁定');

	const lessons = await getMemberLessons(sheets, member['會員ID']);
	const settings = await getLessonSettings(sheets);
	return {
		canBookLesson: lessons.length > 0,
		lessonCount: lessons.filter((l) => l['狀態'] === '已確認').length,
		lineContactUrl: settings.lineContactUrl,
		durationMinutes: settings.durationMinutes,
		myLessons: lessons.sort((a, b) => new Date(b['預約日期時間']) - new Date(a['預約日期時間']))
	};
}

export async function getAvailableLessonSlots(sheets, env, dateStr) {
	if (await hasActivityOnDate(sheets, dateStr)) {
		return [];
	}

	const settings = await getLessonSettings(sheets);
	const stepMinutes = settings.durationMinutes + settings.bufferMinutes;

	const dayStart = new Date(buildTaipeiISOString(dateStr, settings.openTime));
	const dayEnd = new Date(buildTaipeiISOString(dateStr, settings.closeTime));
	const busyTimes = await getBusyTimes(env, dayStart.toISOString(), dayEnd.toISOString());
	const busyIntervals = busyTimes.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));

	const now = new Date();
	const slots = [];
	let cursor = dayStart;
	while (true) {
		const slotEnd = new Date(cursor.getTime() + settings.durationMinutes * 60000);
		if (slotEnd > dayEnd) break;
		const overlapsBusy = busyIntervals.some((b) => cursor < b.end && slotEnd > b.start);
		if (!overlapsBusy && cursor > now) {
			slots.push(toTaipeiTimeString(cursor));
		}
		cursor = new Date(cursor.getTime() + stepMinutes * 60000);
	}
	return slots;
}

export async function bookLesson(sheets, env, auth, { date, startTime, note }) {
	const member = await findMemberByLineUserId(sheets, auth.lineUserId);
	if (!member) throw new Error('找不到會員資料，請先完成帳號綁定');

	const existingLessons = await getMemberLessons(sheets, member['會員ID']);
	if (existingLessons.length === 0) {
		throw new Error('請先私訊負責人完成第一次預約，之後才能自助預約');
	}

	return createLessonInternal(sheets, env, member, date, startTime, note);
}

export async function createLessonForMember(sheets, env, auth, { memberId, date, startTime, note }) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const member = await findMemberById(sheets, memberId);
	if (!member) throw new Error('找不到會員資料');

	return createLessonInternal(sheets, env, member, date, startTime, note);
}

async function createLessonInternal(sheets, env, member, date, startTime, note) {
	if (await hasActivityOnDate(sheets, date)) {
		throw new Error('這天已經有團體活動，無法預約一對一');
	}

	const settings = await getLessonSettings(sheets);
	const startISO = buildTaipeiISOString(date, startTime);
	const startDate = new Date(startISO);
	if (isNaN(startDate.getTime())) throw new Error('時間格式不正確');
	if (startDate <= new Date()) throw new Error('不能預約已經過去的時間');

	const endDate = new Date(startDate.getTime() + settings.durationMinutes * 60000);
	const endISO = endDate.toISOString();

	// 下單前重新查一次忙碌區間，避免兩個人在極短時間內搶同一個時段
	const busyTimes = await getBusyTimes(env, startISO, endISO);
	const overlapsBusy = busyTimes.some((b) => startDate < new Date(b.end) && endDate > new Date(b.start));
	if (overlapsBusy) {
		throw new Error('這個時段剛好被預約走了，請重新選擇時段');
	}

	const calendarEventId = await createCalendarEvent(env, {
		summary: '一對一教學：' + member['姓名'],
		description: '會員：' + member['姓名'] + '（' + member['手機'] + '）' + (note ? '\n留言：' + note : ''),
		startISO,
		endISO
	});

	const lessonId = await sheets.generateNextId('Lessons', '預約ID', 'L', 4);
	await sheets.appendRowFromObject('Lessons', {
		預約ID: lessonId,
		會員ID: member['會員ID'],
		預約日期時間: toSheetsDateTimeString(startDate),
		結束時間: toSheetsDateTimeString(endDate),
		狀態: '已確認',
		特殊留言: note || '',
		GoogleCalendar事件ID: calendarEventId,
		建立時間: toSheetsDateTimeString(new Date()),
		已提醒: '否'
	});

	await pushMessageToAdmin(env,
		'📅 新的一對一預約\n學員：' + member['姓名'] + '\n時間：' + date + ' ' + startTime + (note ? '\n留言：' + note : ''));

	return { success: true, lessonId };
}

export async function cancelLesson(sheets, env, auth, lessonId) {
	const lessons = await sheets.getSheetAsObjects('Lessons');
	const lesson = lessons.find((l) => l['預約ID'] === lessonId);
	if (!lesson) throw new Error('找不到預約紀錄');

	if (!auth.isAdmin) {
		const member = await findMemberByLineUserId(sheets, auth.lineUserId);
		if (!member || member['會員ID'] !== lesson['會員ID']) throw new Error('沒有權限');
	}

	if (lesson['GoogleCalendar事件ID']) {
		await deleteCalendarEvent(env, lesson['GoogleCalendar事件ID']);
	}
	await sheets.updateRowFromObject('Lessons', lesson._rowNumber, { 狀態: '已取消' });

	await pushMessageToAdmin(env, '❌ 一對一預約已取消\n時間：' + formatForMessage(lesson['預約日期時間']));
	return { success: true };
}

export async function updateLessonTime(sheets, env, auth, { lessonId, date, startTime }) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const lessons = await sheets.getSheetAsObjects('Lessons');
	const lesson = lessons.find((l) => l['預約ID'] === lessonId);
	if (!lesson) throw new Error('找不到預約紀錄');

	const settings = await getLessonSettings(sheets);
	const startDate = new Date(buildTaipeiISOString(date, startTime));
	if (isNaN(startDate.getTime())) throw new Error('時間格式不正確');
	const endDate = new Date(startDate.getTime() + settings.durationMinutes * 60000);

	if (lesson['GoogleCalendar事件ID']) {
		await updateCalendarEvent(env, lesson['GoogleCalendar事件ID'], {
			startISO: startDate.toISOString(),
			endISO: endDate.toISOString()
		});
	}
	// 改期後重設提醒狀態，不然新時間可能因為舊的「已提醒」紀錄而漏掉提醒
	await sheets.updateRowFromObject('Lessons', lesson._rowNumber, {
		預約日期時間: toSheetsDateTimeString(startDate),
		結束時間: toSheetsDateTimeString(endDate),
		已提醒: '否'
	});
	return { success: true };
}

export async function getAllLessonsForAdmin(sheets, auth) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const lessons = await sheets.getSheetAsObjects('Lessons');
	const decorated = await Promise.all(lessons.map(async (l) => {
		const member = await findMemberById(sheets, l['會員ID']);
		l['會員姓名'] = member ? member['姓名'] : l['會員ID'];
		return l;
	}));
	return decorated.sort((a, b) => new Date(b['預約日期時間']) - new Date(a['預約日期時間']));
}

// 給 scheduled cron 呼叫：檢查即將開始且還沒提醒過的一對一課，在提醒時間窗內就推播並標記已提醒
export async function sendUpcomingLessonReminders(sheets, env) {
	const settings = await getLessonSettings(sheets);
	const lessons = await sheets.getSheetAsObjects('Lessons');
	const now = new Date();
	const windowEnd = new Date(now.getTime() + settings.reminderLeadMinutes * 60000);

	const due = lessons.filter((l) => {
		if (l['狀態'] !== '已確認' || l['已提醒'] === '是') return false;
		const start = new Date(l['預約日期時間']);
		return start > now && start <= windowEnd;
	});

	for (const lesson of due) {
		const member = await findMemberById(sheets, lesson['會員ID']);
		await pushMessageToAdmin(env,
			'⏰ 一對一課程提醒\n學員：' + (member ? member['姓名'] : lesson['會員ID']) + '\n時間：' + formatForMessage(lesson['預約日期時間']));
		await sheets.updateRowFromObject('Lessons', lesson._rowNumber, { 已提醒: '是' });
	}
}
