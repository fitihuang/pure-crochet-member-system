// 用 LINE Messaging API 主動推播文字訊息給後台管理員（跟只負責登入的 LINE Login 頻道是不同頻道）
export async function pushMessageToAdmin(env, text) {
	const adminIds = env.ADMIN_LINE_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean);

	await Promise.all(adminIds.map(async (userId) => {
		const res = await fetch('https://api.line.me/v2/bot/message/push', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer ' + env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] })
		});
		// 推播失敗不應該讓整個預約/提醒流程整個失敗（例如管理員還沒加官方帳號好友），記錄下來就好
		if (!res.ok) {
			console.log('LINE 推播失敗：', res.status, await res.text());
		}
	}));
}
