function doGet(e) {
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
			case 'getEventList':
				result = getEventList();
				break;
			case 'getEventDetail':
				result = getEventDetail(params.eventId);
				break;
			case 'submitRegistration':
				result = submitRegistration(params.idToken, params.eventId);
				break;
			case 'checkAllMembersUpgrade':
				result = checkAllMembersUpgrade(params.idToken);
				break;
			case 'redeemCoupon':
				result = redeemCoupon(params.idToken, params.couponId, params.registrationId);
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
