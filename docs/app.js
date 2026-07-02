var LIFF_ID = '2010573490-GEPNAkkX';
var WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwRwRWP3OZkejgRm-SCu9q3Ac7KciJGnVgWJB-zfMPZ2WaWXmmYCwEo7FxS7cPNfUA8Xg/exec';

function callApi(action, params) {
	var payload = Object.assign({ action: action }, params || {});
	return fetch(WEB_APP_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'text/plain;charset=utf-8' },
		body: JSON.stringify(payload)
	})
		.then(function (res) { return res.json(); })
		.then(function (result) {
			if (result && result.error) throw new Error(result.error);
			return result;
		});
}

// 回傳 idToken；如果還沒登入，liff.login() 會導轉出去，這裡回傳 null 讓呼叫端不要往下執行
function initLiff() {
	return liff.init({ liffId: LIFF_ID }).then(function () {
		if (!liff.isLoggedIn()) {
			liff.login();
			return null;
		}
		return liff.getIDToken();
	});
}

function formatDate(value) {
	if (!value) return '';
	var date = new Date(value);
	return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
}

function logout() {
	liff.logout();
	location.reload();
}
