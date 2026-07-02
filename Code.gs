function doGet(e) {
	// GET 網址容易留在瀏覽器紀錄/伺服器 log 裡，帶身份憑證的請求一律擋掉，只留給不需要登入的查詢用
	if (e.parameter.idToken) {
		return ContentService.createTextOutput(JSON.stringify({ error: '需要身份驗證的操作請用 POST' }))
			.setMimeType(ContentService.MimeType.JSON);
	}
	return handleApiRequest(e.parameter.action, e.parameter);
}

function doPost(e) {
	var params = JSON.parse(e.postData.contents);
	return handleApiRequest(params.action, params);
}

// 前端改放在 GitHub Pages（跨網域呼叫），這裡一律回傳 JSON，
// 錯誤也要包成 JSON 而不是丟出去，不然前端 fetch 解析會直接爛掉
function handleApiRequest(action, params) {
	var result;
	try {
		switch (action) {
			case 'getMemberProfile':
				result = getMemberProfile(params.idToken);
				break;
			case 'bindLineUserId':
				result = bindLineUserId(params.idToken, params.phoneOrEmail);
				break;
			case 'getAllMembers':
				result = getAllMembers(params.idToken);
				break;
			case 'createMember':
				result = createMember(params.idToken, params.memberData);
				break;
			case 'updateMember':
				result = updateMember(params.idToken, params.memberId, params.memberData);
				break;
			case 'getEventList':
				result = getEventList();
				break;
			case 'getEventDetail':
				result = getEventDetail(params.eventId);
				break;
			case 'getAllEventsForAdmin':
				result = getAllEventsForAdmin(params.idToken);
				break;
			case 'createEvent':
				result = createEvent(params.idToken, params.eventData);
				break;
			case 'updateEvent':
				result = updateEvent(params.idToken, params.eventId, params.eventData);
				break;
			case 'submitRegistration':
				result = submitRegistration(params.idToken, params.eventId);
				break;
			case 'getEventRegistrationsForAdmin':
				result = getEventRegistrationsForAdmin(params.idToken, params.eventId);
				break;
			case 'updateRegistrationPayment':
				result = updateRegistrationPayment(params.idToken, params.registrationId, params.isPaid);
				break;
			case 'checkAllMembersUpgrade':
				result = checkAllMembersUpgrade(params.idToken);
				break;
			case 'redeemCoupon':
				result = redeemCoupon(params.idToken, params.couponId, params.registrationId);
				break;
			case 'getGradeList':
				result = getGradeList();
				break;
			default:
				result = { error: '未知的 action: ' + action };
		}
	} catch (err) {
		result = { error: err.message };
	}
	return ContentService.createTextOutput(JSON.stringify(result))
		.setMimeType(ContentService.MimeType.JSON);
}
