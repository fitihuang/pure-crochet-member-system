const PUBLIC_BUCKET_URL = 'https://pub-adbb4210febc453498def24e27ab01ce.r2.dev';

// base64Image 格式是 data URL（例如 data:image/png;base64,xxxx），前面的描述要去掉才能還原成真正的圖片二進位內容
export async function uploadImageToR2(env, auth, base64Image) {
	if (!auth.isAdmin) throw new Error('沒有權限');

	const match = base64Image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
	if (!match) throw new Error('圖片上傳失敗：圖片格式不正確');

	const contentType = match[1];
	const extension = contentType.split('/')[1];
	const binary = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

	const key = 'events/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + extension;
	await env.IMAGES_BUCKET.put(key, binary, { httpMetadata: { contentType } });

	return { url: PUBLIC_BUCKET_URL + '/' + key };
}

// 換封面圖或活動不需要圖片時，把 R2 上舊的檔案一併清掉，避免免費額度被用不到的圖片慢慢吃掉
export async function deleteImageFromR2(env, imageUrl) {
	if (!imageUrl || imageUrl.indexOf(PUBLIC_BUCKET_URL) !== 0) return;
	const key = imageUrl.slice(PUBLIC_BUCKET_URL.length + 1);
	await env.IMAGES_BUCKET.delete(key);
}
