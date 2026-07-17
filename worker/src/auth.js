export async function verifyLineToken(env, idToken) {
	const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: 'id_token=' + encodeURIComponent(idToken) + '&client_id=' + encodeURIComponent(env.LINE_LOGIN_CHANNEL_ID)
	});
	const data = await response.json();
	if (!data.sub) {
		throw new Error('LINE token 驗證失敗');
	}

	const adminIds = env.ADMIN_LINE_USER_IDS.split(',').map((id) => id.trim());
	return {
		lineUserId: data.sub,
		isAdmin: adminIds.indexOf(data.sub) !== -1
	};
}
