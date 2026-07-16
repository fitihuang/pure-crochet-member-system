var LIFF_ID = '2010573490-GEPNAkkX';
var WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwRwRWP3OZkejgRm-SCu9q3Ac7KciJGnVgWJB-zfMPZ2WaWXmmYCwEo7FxS7cPNfUA8Xg/exec';

function callApi(action, params) {
	var payload = Object.assign({ action: action }, params || {});
	return fetch(WEB_APP_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'text/plain;charset=utf-8' },
		body: JSON.stringify(payload)
	})
		.then(function (res) { return res.text(); })
		.then(function (text) {
			var result;
			try {
				result = JSON.parse(text);
			} catch (e) {
				// Apps Script 偶爾會回傳一整頁 HTML 而不是 JSON（伺服器端不穩定，不是我們的程式碼壞了）。
				// 不自動重試，因為如果是「新增/修改」這類操作，重試有可能造成重複寫入，交給使用者自己判斷再手動重試
				throw new Error('伺服器回應異常，請確認這個操作是否已經成功執行（避免重複送出），稍後再試一次');
			}
			if (result && result.error) throw new Error(result.error);
			return result;
		});
}

// 只做初始化，不自動觸發登入導轉，讓使用者先看到頁面、自己按按鈕才登入
function initLiff() {
	return liff.init({ liffId: LIFF_ID });
}

// 頁面一載入就先偷打一次不重要的 API，讓 Apps Script 有機會提前開始執行，
// 減少使用者真正登入完成、要抓資料時遇到冷啟動延遲。失敗也沒關係，不影響後續流程
callApi('getEventList').catch(function () {});

function formatDate(value) {
	if (!value) return '';
	var date = new Date(value);
	return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
}

// 給 <input type="date"> 用，把後端回傳的日期轉成 YYYY-MM-DD
function toDateInputValue(value) {
	if (!value) return '';
	var date = new Date(value);
	var month = String(date.getMonth() + 1).padStart(2, '0');
	var day = String(date.getDate()).padStart(2, '0');
	return date.getFullYear() + '-' + month + '-' + day;
}

// 依會員自己的等級決定顯示哪個價格
function getDisplayPrice(event, grade) {
	var isGold = grade && grade['會員等級名稱'] === '金牌會員';
	return isGold ? event['金牌會員費用'] : event['一般會員費用'];
}

function logout() {
	liff.logout();
	location.reload();
}

// 報名處理中蓋一層全螢幕遮罩，避免使用者在等結果的時候又點別的活動
function showLockOverlay(text) {
	var el = document.createElement('div');
	el.id = 'lockOverlay';
	el.className = 'lockOverlay';
	el.innerHTML = '<div class="spinner"></div><div>' + (text || '處理中...') + '</div>';
	document.body.appendChild(el);
}

function hideLockOverlay() {
	var el = document.getElementById('lockOverlay');
	if (el) el.remove();
}
