// 用服務帳號金鑰跟 Google 換取一組短效的 access token，Sheets API 的每次讀寫都要帶這個
function base64url(input) {
	return btoa(String.fromCharCode(...new Uint8Array(input)))
		.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(str) {
	return base64url(new TextEncoder().encode(str));
}

async function importPrivateKey(pem) {
	const pemContents = pem
		.replace('-----BEGIN PRIVATE KEY-----', '')
		.replace('-----END PRIVATE KEY-----', '')
		.replace(/\s/g, '');
	const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey(
		'pkcs8',
		binaryDer.buffer,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	);
}

export async function getGoogleAccessToken(env) {
	const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'RS256', typ: 'JWT' };
	const claims = {
		iss: credentials.client_email,
		scope: 'https://www.googleapis.com/auth/spreadsheets',
		aud: 'https://oauth2.googleapis.com/token',
		exp: now + 3600,
		iat: now
	};

	const signingInput = base64urlFromString(JSON.stringify(header)) + '.' + base64urlFromString(JSON.stringify(claims));
	const key = await importPrivateKey(credentials.private_key);
	const signatureBuffer = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		new TextEncoder().encode(signingInput)
	);
	const jwt = signingInput + '.' + base64url(signatureBuffer);

	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
	});
	const data = await response.json();
	if (!data.access_token) {
		throw new Error('無法取得 Google access token: ' + JSON.stringify(data));
	}
	return data.access_token;
}
