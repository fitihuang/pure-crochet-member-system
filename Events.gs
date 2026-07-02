function getEventList() {
	return getSheetAsObjects('Events')
		.filter(function (event) { return event['狀態'] === '開放報名'; })
		.map(decorateEventWithRemainingQuota);
}

function decorateEventWithRemainingQuota(event) {
	var vipGradeId = getGradeIdByName('金牌會員');
	var registrations = getSheetAsObjects('Registrations').filter(function (r) {
		return r['活動ID'] === event['活動ID'];
	});
	var vipUsed = registrations.filter(function (r) { return r['佔用名額類別'] === vipGradeId; }).length;
	var generalUsed = registrations.length - vipUsed;

	event['VIP剩餘名額'] = event['VIP保留名額'] - vipUsed;
	event['一般剩餘名額'] = event['一般名額'] - generalUsed;
	return event;
}

function getEventDetail(eventId) {
	var event = findEventById(eventId);
	if (!event) throw new Error('找不到該活動');
	return decorateEventWithRemainingQuota(event);
}

function getAllEventsForAdmin(idToken) {
	var auth = verifyLineToken(idToken);
	if (!auth.isAdmin) throw new Error('沒有權限');
	return getSheetAsObjects('Events').map(decorateEventWithRemainingQuota);
}

function createEvent(idToken, eventData) {
	var auth = verifyLineToken(idToken);
	if (!auth.isAdmin) throw new Error('沒有權限');

	var eventId = generateNextId('Events', '活動ID', 'E', 4);
	var data = Object.assign({ '活動ID': eventId, '狀態': '開放報名' }, eventData);
	convertEventDateFields(data);
	appendRowFromObject('Events', data);
	return { success: true, eventId: eventId };
}

function updateEvent(idToken, eventId, eventData) {
	var auth = verifyLineToken(idToken);
	if (!auth.isAdmin) throw new Error('沒有權限');

	var event = findEventById(eventId);
	if (!event) throw new Error('找不到該活動');

	var data = Object.assign({}, eventData);
	convertEventDateFields(data);
	updateRowFromObject('Events', event._rowNumber, data);
	return { success: true };
}

function convertEventDateFields(data) {
	if (data['活動日期']) data['活動日期'] = new Date(data['活動日期']);
	if (data['報名截止日']) data['報名截止日'] = new Date(data['報名截止日']);
}

function findEventById(eventId) {
	var events = getSheetAsObjects('Events');
	for (var i = 0; i < events.length; i++) {
		if (events[i]['活動ID'] === eventId) return events[i];
	}
	return null;
}
