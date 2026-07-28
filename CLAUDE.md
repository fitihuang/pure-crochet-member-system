# Pure Crochet 會員系統

鉤織品牌 Pure Crochet 的會員系統，**已上線使用中**（跟 `vitopaint` 這個 repo 是完全不同的客戶/專案，不要搞混）。

## 上線網址

- 會員頁：https://fitihuang.github.io/pure-crochet-member-system/
- 活動詳情頁：https://fitihuang.github.io/pure-crochet-member-system/event.html?eventId=xxx
- 管理後台：https://fitihuang.github.io/pure-crochet-member-system/admin.html
- 後端 API：https://pure-crochet-backend.pure-crochet.workers.dev（Cloudflare Workers）

## 架構

- **前端**：純靜態 HTML/CSS/JS，`docs/` 資料夾（`index.html` 會員頁、`admin.html` 後台、`event.html` 活動詳情、`app.js` 共用函式），GitHub Pages 架站（GitHub 帳號 `fitihuang`，public repo）。
- **後端**：Cloudflare Workers，`worker/` 資料夾，`worker/src/index.js` 的 `handleApiRequest` 統一分派 `action`，一律回傳 JSON。部署：`cd worker && npx wrangler deploy`。
- **資料庫**：Google Sheets，直接打 Sheets API（沒有 Apps Script 這一層了，2026-07 已完整遷移），用服務帳號 `sheets-access@pure-crochet-backend.iam.gserviceaccount.com` 的 JWT 授權（`worker/src/googleAuth.js`），scope 同時有 spreadsheets 跟 calendar。
- **分頁**：`Members` / `Events` / `Registrations` / `Grade` / `Purchases` / `Settings` / `Lessons`（一對一預約）。
- **圖片**：Cloudflare R2（`worker/src/imageUpload.js`），bucket `pure-crochet-images`，公開網址前綴 `https://pub-adbb4210febc453498def24e27ab01ce.r2.dev`。原本用 imgbb，因為它會間歇性擋 Cloudflare Workers 機房 IP 才換掉。
- **Google Calendar 整合**：團體活動（Events）跟一對一預約（Lessons）都會同步建立/更新/刪除對應的 Calendar 事件（`worker/src/calendar.js`），純輔助顯示 + 一對一時段的忙碌區間判斷用，同步失敗不會擋掉主要操作。
- **LINE**：LINE Login（`worker/src/auth.js`，僅登入用）跟 LINE Messaging API（`worker/src/lineMessaging.js`，負責人推播通知用）是兩個獨立頻道，不要搞混。

## 部署流程

- 改 `worker/src/*.js` → `cd worker && npx wrangler deploy`。
- 改 `docs/*.html`／`docs/app.js` → `git push`，GitHub Pages 會自動建置，可以用 `gh api repos/fitihuang/pure-crochet-member-system/pages/builds/latest --jq '.status'` 輪詢直到變成 `built`。
- **GitHub Pages 對 `.html`/`.js` 設了 `cache-control: max-age=600`**：改完 push 後在瀏覽器測試，就算開新分頁也可能吃到舊版快取。驗證線上真的是新版，用 `curl` 直接看原始檔，或是瀏覽器網址後面加個 `?cachebust=1` 之類的 query string 強制略過快取。

## 資料表重點欄位

- **Members**：`會員ID` / `LINE userId` / `姓名` / `Email` / `手機` / `累積付費活動次數` / `會員等級ID` / `加入日期` / `一對一資格`（是/否，標註可直接自助預約一對一的固定學員，不用先手動建一筆解鎖）
- **Events**：`活動ID` / `活動名稱` / `活動日期` / `開始時間` / `結束時間`（可空白＝自由離席，**不是 bug**）/ `活動地點` / `活動地點地圖網址` / `報名截止日`（後台表單現在強制必填，空白會導致永遠開放報名）/ `狀態` / 名額與費用欄位 / `活動封面圖片網址` / `GoogleCalendar事件ID`
- **Lessons**：`預約ID` / `會員ID` / `預約日期時間` / `結束時間` / `狀態`（已確認/已取消）/ `特殊留言` / `GoogleCalendar事件ID` / `建立時間` / `已提醒`
- **Settings**（`設定項目`/`內容` 通用鍵值表，後台有表單可改，不用手動去 Sheet 改）：付款資訊、`一對一可選時長分鐘`（逗號分隔清單如 `60,90,120`，2026-07-27 從單一固定時長改的）、`一對一緩衝時間分鐘`、`一對一預約開放時段起/迄`、`一對一課前提醒分鐘數`、`負責人LINE聊天連結`、`一對一課程報價`

## 重要地雷（都是踩過的坑，改東西前務必看一下）

1. **Sheets USER_ENTERED 自動轉型陷阱**：手機號碼這種開頭 0 的數字字串、`"10:00"` 這種純時間字串，直接用原始 Sheets API 寫入會被自動轉成數字/時間序號，讀回來就不是原本的字串了。`worker/src/sheetsApi.js` 的 `toWriteValue` 有做保護，但**只有透過 `appendRowFromObject`/`updateRowFromObject`（或間接透過 `updateSettings`）寫入才會套用**。如果要寫一次性腳本直接打 Sheets API（例如補欄位、修資料），千萬不要繞過這層保護，不然值會被 Sheets 自動轉型壞掉（2026-07-27 就因為一支腳本繞過保護，把一對一預約的開放時段直接寫壞，讀出來變成 `0.4166...` 這種時間序號，導致選日期後噴 `Invalid time value`）。
2. **`DATE_FIELDS`（`sheetsApi.js`）是全域欄位名單，不分表**：只要欄位名字命中（例如 `結束時間`），不管是哪張表的欄位都會套用日期序號轉換邏輯。新增欄位時如果剛好撞名，要注意這個副作用。
3. **時區一律走 `worker/src/dateUtils.js` 的共用函式**（`todayAtMidnight` / `toTaipeiDateString` / `toTaipeiTimeString` / `toSheetsDateTimeString`），不要在各檔案自己土法煉鋼算 +8 小時，之前重複犯過同樣的 bug。
4. **`fetchRange`（sheetsApi.js）錯誤處理**：只有 HTTP 400（分頁真的不存在）才當成「沒有資料」回傳空陣列；其他狀態碼（429/500 等暫時性錯誤）會丟出明確錯誤，不能悄悄吞掉，不然會出現「找不到會員資料」這種誤導性錯誤訊息。
5. **Calendar／LINE 推播都是 fault-tolerant 的附加效果**：包在 try/catch 裡，失敗只 `console.log`，絕對不能擋到 Sheets 的主要寫入操作。新增類似的外部整合要沿用這個模式。
6. **Workers 每個 isolate 可能同時處理不同使用者的請求**，不能用模組層級全域變數當快取（那是 Apps Script 時代的寫法），要用 `createSheetsClient(env)` 每次請求各自產生獨立快取。

## 測試方法論

改後端邏輯時，習慣用 `worker/` 底下的模組直接寫 ad-hoc node script（放在系統 scratchpad，不要留在 repo 裡），用真實的服務帳號憑證直接讀寫正式的 Google Sheet／Calendar 來驗證邏輯，不用等真人上線測試。測完記得清理掉建立的測試資料（刪除測試列、測試 Calendar 事件）。前端改動則用瀏覽器直接注入測試資料呼叫 render 函式（因為 LINE OAuth 登入無法在自動化瀏覽器裡完成）。

## 待辦 / 待確認事項

- **`LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` 這個 Worker secret 還沒設定**：負責人需要去 LINE Official Account Manager 開通 Messaging API（沿用現有的 `@qzj9528m` 官方帳號），拿到 Channel Access Token 後用 `wrangler secret put LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` 設定。在補上之前，新預約通知/課前提醒推播都會靜默失敗（不影響預約本身能不能成立）。
- 系統帳號權責（Google/GitHub/Cloudflare 帳號）目前都掛在使用者自己名下，**尚未正式移交給負責人**，之前討論偏向用「分享存取權」而非整套轉移，但還沒拍板執行。

## 程式碼慣例

- Tab 縮排、函式 camelCase、註解用繁體中文，且只寫「為什麼」，不寫「做什麼」。
- 主邏輯簡潔，複雜判斷（Excel/Sheets 解析、時間運算等）拆成獨立小函式。
- 不加不需要的防呆/相容層——這個系統目前只有負責人一個管理者、直接控制所有寫入路徑，遇到「理論上會發生」但實際不會發生的情境不用特別處理。
