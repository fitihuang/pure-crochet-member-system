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

export async function createCalendarEvent(env, { summary, description, startISO, endISO }) {
	const event = await calendarFetch(env, 'calendars/' + encodeURIComponent(env.CALENDAR_ID) + '/events', {
		method: 'POST',
		body: JSON.stringify({
			summary,
			description,
			start: { dateTime: startISO, timeZone: TIMEZONE },
			end: { dateTime: endISO, timeZone: TIMEZONE }
		})
	});
	return event.id;
}

export async function updateCalendarEvent(env, eventId, { startISO, endISO }) {
	await calendarFetch(env, 'calendars/' + encodeURIComponent(env.CALENDAR_ID) + '/events/' + encodeURIComponent(eventId), {
		method: 'PATCH',
		body: JSON.stringify({
			start: { dateTime: startISO, timeZone: TIMEZONE },
			end: { dateTime: endISO, timeZone: TIMEZONE }
		})
	});
}

export async function deleteCalendarEvent(env, eventId) {
	await calendarFetch(env, 'calendars/' + encodeURIComponent(env.CALENDAR_ID) + '/events/' + encodeURIComponent(eventId), {
		method: 'DELETE'
	});
}
