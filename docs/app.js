var LIFF_ID = '2011013174-d3z55TUk';
// 暫時指向 Cloudflare Workers 新版後端做測試，確認沒問題後這行會是正式版本
// 舊版 Apps Script 網址：https://script.google.com/macros/s/AKfycbwRwRWP3OZkejgRm-SCu9q3Ac7KciJGnVgWJB-zfMPZ2WaWXmmYCwEo7FxS7cPNfUA8Xg/exec
var WEB_APP_URL = 'https://pure-crochet-backend.pure-crochet.workers.dev';

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
			if (result && result.error) {
				if (isAuthExpiredError(result.error)) {
					handleAuthExpired();
					// 已經處理成導回登入畫面了，回傳一個永遠不會 resolve 的 promise，讓呼叫端原本的 .then/.catch 都不用再跑
					return new Promise(function () {});
				}
				throw new Error(result.error);
			}
			return result;
		});
}

// 這兩種錯誤訊息是後端在「沒帶 idToken」或「LINE token 驗證失敗（含過期）」時丟出來的，
// 代表登入狀態已經失效，要導回登入畫面，不是一般業務錯誤
function isAuthExpiredError(message) {
	return message === '需要登入' || message === 'LINE token 驗證失敗';
}

// LIFF 的 idToken 效期大約 1 小時，過期後沒辦法靜默換發新的，只能請使用者重新走一次登入
function handleAuthExpired() {
	hideLockOverlay();
	liff.logout();
	appAlert('登入已過期，請重新登入').then(function () {
		if (typeof showLoginScreen === 'function') {
			showLoginScreen();
		} else {
			location.reload();
		}
	});
}

// 只做初始化，不自動觸發登入導轉，讓使用者先看到頁面、自己按按鈕才登入
function initLiff() {
	return liff.init({ liffId: LIFF_ID });
}

// 開啟外部連結（例如私訊官方帳號）：在 LINE App 內建瀏覽器打開時，一般的 <a target="_blank">
// 常常只是換到另一個內嵌網頁、不會真的切到聊天畫面，要用 liff.openWindow 加 external:true
// 才能可靠地跳出去開啟對應的畫面（手機上是 LINE App 本身，桌機/沒裝 App 則是官方網站）
function openExternalUrl(url) {
	if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
		liff.openWindow({ url: url, external: true });
	} else {
		window.open(url, '_blank');
	}
}

function formatDate(value) {
	if (!value) return '';
	var date = new Date(value);
	return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
}

// 活動的開始/結束時間欄位是純文字（'HH:MM'），不是日期值。
// 只有開始時間、沒有結束時間代表這場是彈性時間、自由離席的場次，額外加提示文字說明
function formatTimeRange(startTime, endTime) {
	if (startTime && endTime) return startTime + '-' + endTime;
	if (startTime) return startTime + '，時間彈性，自由離席';
	return endTime || '';
}

function formatTime(value) {
	if (!value) return '';
	var date = new Date(value);
	return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
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

// 取代原生 alert/confirm：瀏覽器原生對話框最上面一定會顯示「網址 says」沒辦法客製化，
// 所以自己刻一個彈窗才能顯示「Pure Crochet 會員系統 提醒」這種自訂標題
function showAppModal(message, showCancel) {
	return new Promise(function (resolve) {
		var overlay = document.createElement('div');
		overlay.className = 'appModalOverlay';
		overlay.innerHTML = '' +
			'<div class="appModalBox">' +
			'<div class="appModalTitle">Pure Crochet 會員系統 提醒</div>' +
			'<div class="appModalMessage"></div>' +
			'<div class="appModalButtons">' +
			(showCancel ? '<button class="appModalCancelBtn" style="background:#f2ede6;color:#8a5a3c;">取消</button>' : '') +
			'<button class="appModalOkBtn">確定</button>' +
			'</div>' +
			'</div>';
		overlay.querySelector('.appModalMessage').textContent = message;
		document.body.appendChild(overlay);

		function close(result) {
			overlay.remove();
			resolve(result);
		}
		var cancelBtn = overlay.querySelector('.appModalCancelBtn');
		if (cancelBtn) cancelBtn.onclick = function () { close(false); };
		overlay.querySelector('.appModalOkBtn').onclick = function () { close(true); };
	});
}

function appAlert(message) {
	return showAppModal(message, false);
}

// ---------- 活動自訂報名欄位（下拉選單／多選 checkbox／自由留言） ----------

// 活動的「自訂欄位設定」存在 Sheet 裡是一段 JSON 字串，格式不對或沒設定都當作沒有欄位，不能因此擋住報名
function parseEventCustomFields(rawJson) {
	if (!rawJson) return [];
	try {
		var fields = JSON.parse(rawJson);
		return Array.isArray(fields) ? fields : [];
	} catch (e) {
		return [];
	}
}

// 選項現在是 {label, price} 物件（price 選填，沒填就是 0，不影響金額）；這裡統一補一個顯示用的加價說明
function formatOptionPriceHint(price) {
	return price ? '（+$' + price + '）' : '';
}

// 組出報名表單裡自訂欄位的 HTML，select 是單選、checkbox 是可複選、text 是自由留言；
// select/checkbox 選了會加價的選項時，透過 onchange 即時更新下面的加購小計
function buildCustomFieldsFormHtml(fields) {
	var html = fields.map(function (field, index) {
		var labelHtml = '<div style="margin-bottom:14px;"><span class="fieldLabel" style="font-size:12px;color:#a89a8a;">' + field.label + '</span>';
		if (field.type === 'select') {
			var options = '<option value="">請選擇</option>' + (field.options || []).map(function (opt) {
				return '<option value="' + opt.label + '">' + opt.label + formatOptionPriceHint(opt.price) + '</option>';
			}).join('');
			return labelHtml + '<select id="customField_' + index + '" onchange="updateCustomFieldsEstimate()" style="width:100%;padding:10px;font-size:14px;border:1px solid #e0d8cc;border-radius:10px;font-family:inherit;background:#fff;">' + options + '</select></div>';
		}
		if (field.type === 'checkbox') {
			var checkboxes = (field.options || []).map(function (opt, optIndex) {
				return '<label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:14px;">' +
					'<input type="checkbox" id="customField_' + index + '_' + optIndex + '" onchange="updateCustomFieldsEstimate()" style="width:auto;margin:0;">' + opt.label + formatOptionPriceHint(opt.price) + '</label>';
			}).join('');
			return labelHtml + '<div>' + checkboxes + '</div></div>';
		}
		return labelHtml + '<textarea id="customField_' + index + '" style="width:100%;min-height:60px;padding:10px;border:1px solid #e0d8cc;border-radius:10px;font-family:inherit;"></textarea></div>';
	}).join('');
	return html + '<div id="customFieldsEstimate" style="font-size:13px;color:#8a5a3c;text-align:right;"></div>';
}

// 目前彈窗裡正在顯示的欄位設定，給 updateCustomFieldsEstimate 讀，不用整包答案物件重算一次
var activeCustomFieldsForEstimate = [];

// 即時算出目前勾選/選擇的加價選項合計，讓使用者填的時候就知道要多付多少（正式金額還是由後端依同一份欄位設定重算，不會信任前端算出來的數字）
function updateCustomFieldsEstimate() {
	var el = document.getElementById('customFieldsEstimate');
	if (!el) return;
	var total = 0;
	activeCustomFieldsForEstimate.forEach(function (field, index) {
		if (field.type === 'select') {
			var select = document.getElementById('customField_' + index);
			var chosen = (field.options || []).filter(function (opt) { return select && opt.label === select.value; })[0];
			if (chosen) total += Number(chosen.price) || 0;
		} else if (field.type === 'checkbox') {
			(field.options || []).forEach(function (opt, optIndex) {
				var box = document.getElementById('customField_' + index + '_' + optIndex);
				if (box && box.checked) total += Number(opt.price) || 0;
			});
		}
	});
	el.textContent = total > 0 ? '加購小計：$' + total : '';
}

// 從表單讀出填寫的值，組成 {欄位標題: 值} 的物件；select/text 是字串，checkbox 是陣列，沒填的欄位不會出現在結果裡
function collectCustomFieldAnswers(fields) {
	var answers = {};
	fields.forEach(function (field, index) {
		if (field.type === 'checkbox') {
			var checked = (field.options || []).filter(function (opt, optIndex) {
				var el = document.getElementById('customField_' + index + '_' + optIndex);
				return el && el.checked;
			}).map(function (opt) { return opt.label; });
			if (checked.length > 0) answers[field.label] = checked;
		} else {
			var el = document.getElementById('customField_' + index);
			if (el && el.value) answers[field.label] = el.value;
		}
	});
	return answers;
}

// 報名前如果這場活動有設定自訂欄位，先彈出表單讓使用者填，填完（或取消）才決定要不要真的送出報名；
// 沒設定自訂欄位就直接呼叫 onConfirmed，維持原本點一下按鈕就報名的行為
function showRegistrationForm(event, onConfirmed) {
	var fields = parseEventCustomFields(event['自訂欄位設定']);
	if (fields.length === 0) {
		onConfirmed({});
		return;
	}
	activeCustomFieldsForEstimate = fields;
	var overlay = document.createElement('div');
	overlay.className = 'appModalOverlay';
	overlay.innerHTML = '' +
		'<div class="appModalBox" style="max-width:360px;max-height:80vh;overflow-y:auto;">' +
		'<div class="appModalTitle">報名前請填寫以下資訊</div>' +
		buildCustomFieldsFormHtml(fields) +
		'<div class="appModalButtons">' +
		'<button class="appModalCancelBtn" style="background:#f2ede6;color:#8a5a3c;">取消</button>' +
		'<button class="appModalOkBtn">確認報名</button>' +
		'</div>' +
		'</div>';
	document.body.appendChild(overlay);
	overlay.querySelector('.appModalCancelBtn').onclick = function () { overlay.remove(); };
	overlay.querySelector('.appModalOkBtn').onclick = function () {
		var answers = collectCustomFieldAnswers(fields);
		overlay.remove();
		onConfirmed(answers);
	};
}

// 給後台報名名單用：把存起來的自訂欄位回覆 JSON 字串轉成一行一行的文字，checkbox 的多個答案用頓號連起來
function formatCustomFieldAnswersHtml(rawJson) {
	if (!rawJson) return '';
	var answers;
	try {
		answers = JSON.parse(rawJson);
	} catch (e) {
		return '';
	}
	var lines = Object.keys(answers).map(function (label) {
		var value = answers[label];
		return label + '：' + (Array.isArray(value) ? value.join('、') : value);
	});
	if (lines.length === 0) return '';
	return '<div style="color:#8c8378;font-size:12px;margin-top:2px;">' + lines.join('<br>') + '</div>';
}

function appConfirm(message) {
	return showAppModal(message, true);
}
