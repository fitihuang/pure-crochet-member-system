export async function uploadImageToImgbb(env, auth, base64Image) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const body = new URLSearchParams();
	body.set('image', base64Image);

	const response = await fetch('https://api.imgbb.com/1/upload?key=' + env.IMGBB_API_KEY, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});
	const rawText = await response.text();
	let result;
	try {
		result = JSON.parse(rawText);
	} catch (err) {
		throw new Error('圖片上傳失敗：imgbb 回傳非預期內容（狀態碼 ' + response.status + '）');
	}
	if (!result.success) {
		throw new Error('圖片上傳失敗：' + (result.error ? result.error.message : '未知錯誤'));
	}
	return { url: result.data.url };
}
