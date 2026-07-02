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

// 只做初始化，不自動觸發登入導轉，讓使用者先看到頁面、自己按按鈕才登入
function initLiff() {
	return liff.init({ liffId: LIFF_ID });
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
