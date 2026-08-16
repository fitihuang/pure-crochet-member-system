import { verifyLineToken } from './auth.js';
import { createSheetsClient } from './sheetsApi.js';
import { getGradeList } from './grades.js';
import {
	getMemberProfile, getAllMembers, createMember, updateMember,
	checkAllMembersUpgrade, runMemberUpgradeCheck, applyForMembership,
	checkHonorMemberUpgrades
} from './members.js';
import { getEventList, getEventDetail, getAllEventsForAdmin, createEvent, updateEvent, deleteEvent } from './events.js';
import { submitRegistration, getEventRegistrationsForAdmin, updateRegistrationPayment, sendUpcomingEventReminders, deleteRegistration } from './registrations.js';
import { getSettings, updateSettings } from './settings.js';
import { uploadImageToR2 } from './imageUpload.js';
import {
	getLessonBookingInfo, getAvailableLessonSlots, bookLesson, cancelLesson,
	getAllLessonsForAdmin, createLessonForMember, updateLessonTime, sendUpcomingLessonReminders
} from './lessons.js';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

// 需要登入身份的 action，統一在分派前驗證一次，業務邏輯函式就不用各自重打一次 LINE API
const AUTH_REQUIRED_ACTIONS = new Set([
	'getMemberProfile', 'getAllMembers', 'createMember', 'updateMember',
	'applyForMembership',
	'getAllEventsForAdmin', 'createEvent', 'updateEvent', 'deleteEvent', 'submitRegistration',
	'getEventRegistrationsForAdmin', 'updateRegistrationPayment', 'deleteRegistration', 'checkAllMembersUpgrade',
	'uploadImage', 'getAvailableLessonSlots', 'bookLesson', 'cancelLesson',
	'getAllLessonsForAdmin', 'createLessonForMember', 'updateLessonTime', 'updateSettings'
]);

function jsonResponse(data) {
	return new Response(JSON.stringify(data), {
		headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
	});
}

export default {
	async fetch(request, env) {
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		let params;
		try {
			if (request.method === 'POST') {
				params = JSON.parse(await request.text());
			} else {
				const url = new URL(request.url);
				params = Object.fromEntries(url.searchParams);
				// GET 網址容易留在瀏覽器紀錄/伺服器 log 裡，帶身份憑證的請求一律擋掉，只留給不需要登入的查詢用
				if (params.idToken) {
					return jsonResponse({ error: '需要身份驗證的操作請用 POST' });
				}
			}
		} catch (err) {
			return jsonResponse({ error: '無效的請求格式' });
		}

		try {
			const result = await handleApiRequest(env, params);
			return jsonResponse(result);
		} catch (err) {
			return jsonResponse({ error: err.message });
		}
	},

	// wrangler.toml 的 [triggers] 設定了三組 cron，這裡依觸發的是哪一組分流：
	// 凌晨那組對應原本 Apps Script 的 dailyMaintenance；上午 9 點那組是活動前一天提醒報名者
	// （特地跟凌晨那組分開，不然使用者半夜收到通知很奇怪）；高頻率那組是一對一課前提醒檢查
	async scheduled(event, env) {
		const sheets = createSheetsClient(env);
		if (event.cron === '0 18 * * *') {
			await runMemberUpgradeCheck(sheets);
			await checkHonorMemberUpgrades(sheets);
		} else if (event.cron === '0 1 * * *') {
			await sendUpcomingEventReminders(sheets, env);
		} else {
			await sendUpcomingLessonReminders(sheets, env);
		}
	}
};

async function handleApiRequest(env, params) {
	const sheets = createSheetsClient(env);
	const action = params.action;

	let auth = null;
	if (AUTH_REQUIRED_ACTIONS.has(action)) {
		if (!params.idToken) throw new Error('需要登入');
		auth = await verifyLineToken(env, params.idToken);
	}

	switch (action) {
		case 'getMemberProfile': {
			const profile = await getMemberProfile(sheets, auth);
			// 還沒綁定就還不是正式會員，不用管一對一預約資訊
			if (!profile.needBinding) {
				Object.assign(profile, await getLessonBookingInfo(sheets, auth));
			}
			return profile;
		}
		case 'applyForMembership':
			return applyForMembership(sheets, env, auth, params.memberData);
		case 'getAllMembers':
			return getAllMembers(sheets, auth);
		case 'createMember':
			return createMember(sheets, auth, params.memberData);
		case 'updateMember':
			return updateMember(sheets, auth, params.memberId, params.memberData);
		case 'getEventList':
			return getEventList(sheets);
		case 'getEventDetail':
			return getEventDetail(sheets, params.eventId);
		case 'getAllEventsForAdmin':
			return getAllEventsForAdmin(sheets, auth);
		case 'createEvent':
			return createEvent(sheets, env, auth, params.eventData);
		case 'updateEvent':
			return updateEvent(sheets, env, auth, params.eventId, params.eventData);
		case 'deleteEvent':
			return deleteEvent(sheets, env, auth, params.eventId);
		case 'submitRegistration':
			return submitRegistration(sheets, env, auth, params.eventId, params.customFieldAnswers);
		case 'getEventRegistrationsForAdmin':
			return getEventRegistrationsForAdmin(sheets, auth, params.eventId);
		case 'updateRegistrationPayment':
			return updateRegistrationPayment(sheets, auth, params.registrationId, params.isPaid);
		case 'deleteRegistration':
			return deleteRegistration(sheets, auth, params.registrationId);
		case 'checkAllMembersUpgrade':
			return checkAllMembersUpgrade(sheets, auth);
		case 'getGradeList':
			return getGradeList(sheets);
		case 'uploadImage':
			return uploadImageToR2(env, auth, params.base64Image);
		case 'getSettings':
			return getSettings(sheets);
		case 'updateSettings':
			return updateSettings(sheets, auth, params.settingsData);
		case 'getAvailableLessonSlots':
			return getAvailableLessonSlots(sheets, env, params.date);
		case 'bookLesson':
			return bookLesson(sheets, env, auth, { date: params.date, startTime: params.startTime, durationMinutes: params.durationMinutes, note: params.note });
		case 'cancelLesson':
			return cancelLesson(sheets, env, auth, params.lessonId);
		case 'getAllLessonsForAdmin':
			return getAllLessonsForAdmin(sheets, auth);
		case 'createLessonForMember':
			return createLessonForMember(sheets, env, auth, { memberId: params.memberId, date: params.date, startTime: params.startTime, durationMinutes: params.durationMinutes, note: params.note });
		case 'updateLessonTime':
			return updateLessonTime(sheets, env, auth, { lessonId: params.lessonId, date: params.date, startTime: params.startTime });
		default:
			return { error: '未知的 action: ' + action };
	}
}
