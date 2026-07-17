import { verifyLineToken } from './auth.js';
import { createSheetsClient } from './sheetsApi.js';
import { getGradeList } from './grades.js';
import {
	getMemberProfile, bindLineUserId, getAllMembers, createMember, updateMember,
	checkAllMembersUpgrade, runMemberUpgradeCheck
} from './members.js';
import { getEventList, getEventDetail, getAllEventsForAdmin, createEvent, updateEvent } from './events.js';
import { submitRegistration, getEventRegistrationsForAdmin, updateRegistrationPayment } from './registrations.js';
import { getSettings } from './settings.js';
import { uploadImageToImgbb } from './imageUpload.js';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

// 需要登入身份的 action，統一在分派前驗證一次，業務邏輯函式就不用各自重打一次 LINE API
const AUTH_REQUIRED_ACTIONS = new Set([
	'getMemberProfile', 'bindLineUserId', 'getAllMembers', 'createMember', 'updateMember',
	'getAllEventsForAdmin', 'createEvent', 'updateEvent', 'submitRegistration',
	'getEventRegistrationsForAdmin', 'updateRegistrationPayment', 'checkAllMembersUpgrade',
	'uploadImageToImgbb'
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

	// 對應原本 Apps Script 的 dailyMaintenance 每日排程，時間在 wrangler.toml 的 [triggers] 設定
	async scheduled(event, env) {
		const sheets = createSheetsClient(env);
		await runMemberUpgradeCheck(sheets);
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
		case 'getMemberProfile':
			return getMemberProfile(sheets, auth);
		case 'bindLineUserId':
			return bindLineUserId(sheets, auth, params.phoneOrEmail);
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
			return createEvent(sheets, auth, params.eventData);
		case 'updateEvent':
			return updateEvent(sheets, auth, params.eventId, params.eventData);
		case 'submitRegistration':
			return submitRegistration(sheets, auth, params.eventId);
		case 'getEventRegistrationsForAdmin':
			return getEventRegistrationsForAdmin(sheets, auth, params.eventId);
		case 'updateRegistrationPayment':
			return updateRegistrationPayment(sheets, auth, params.registrationId, params.isPaid);
		case 'checkAllMembersUpgrade':
			return checkAllMembersUpgrade(sheets, auth);
		case 'getGradeList':
			return getGradeList(sheets);
		case 'uploadImageToImgbb':
			return uploadImageToImgbb(env, auth, params.base64Image);
		case 'getSettings':
			return getSettings(sheets);
		default:
			return { error: '未知的 action: ' + action };
	}
}
