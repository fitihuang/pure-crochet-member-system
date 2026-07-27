import { getGoogleAccessToken } from './googleAuth.js';

const TIMEZONE = 'Asia/Taipei';

async function calendarFetch(env, path, options) {
	const token = await getGoogleAccessToken(env);
	const res = await fetch('https://www.googleapis.com/calendar/v3/' + path, {
		...options,
		headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, options && options.headers)
	});
	if (!res.ok) {
		throw new Error('Google Calendar API 錯誤（狀態碼 ' + res.status + '）：' + (await res.text()));
	}
	return res.status === 204 ? null : res.json();
}

// 回傳指定時間範圍內，負責人日曆上已經有事的區間（含既有的一對一課、負責人自己排的其他行程）
export async function getBusyTimes(env, timeMinISO, timeMaxISO) {
	const data = await calendarFetch(env, 'freeBusy', {
		method: 'POST',
		body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: env.CALENDAR_ID }] })
	});
	const calendar = data.calendars[env.CALENDAR_ID];
	return (calendar && calendar.busy) || [];
}

// 有明確時間就建時段事件，完全沒時間（startDate/endDate）就建全天事件，
// endDate 是 Google Calendar 全天事件慣例的「不含」結束日，要傳隔天日期
function buildTimeFields({ startISO, endISO, startDate, endDate }) {
	if (startDate) {
		return { start: { date: startDate }, end: { date: endDate } };
	}
	return {
		start: { dateTime: startISO, timeZone: TIMEZONE },
		end: { dateTime: endISO, timeZone: TIMEZONE }
	};
}

export async function createCalendarEvent(env, { summary, description, startISO, endISO, startDate, endDate }) {
	const event = await calendarFetch(env, 'calendars/' + encodeURIComponent(env.CALENDAR_ID) + '/events', {
		method: 'POST',
		body: JSON.stringify(Object.assign({ summary, description }, buildTimeFields({ startISO, endISO, startDate, endDate })))
	});
	return event.id;
}

export async function updateCalendarEvent(env, eventId, { summary, description, startISO, endISO, startDate, endDate }) {
	const body = buildTimeFields({ startISO, endISO, startDate, endDate });
	if (summary !== undefined) body.summary = summary;
	if (description !== undefined) body.description = description;
	await calendarFetch(env, 'calendars/' + encodeURIComponent(env.CALENDAR_ID) + '/events/' + encodeURIComponent(eventId), {
		method: 'PATCH',
		body: JSON.stringify(body)
	});
}

export async function deleteCalendarEvent(env, eventId) {
	await calendarFetch(env, 'calendars/' + encodeURIComponent(env.CALENDAR_ID) + '/events/' + encodeURIComponent(eventId), {
		method: 'DELETE'
	});
}
