# Pure Crochet 會員系統 — 系統規格書

> 本文件描述系統**目前實際運作的行為**（reverse-engineered from source，非設計階段的願景文件）。若程式碼與本文件不一致，以程式碼為準，並回來更新本文件。
>
> 品牌：Pure Crochet（鉤織課程/活動品牌）。**已上線使用中**，真實會員與金流資料都在裡面，改動前請務必理解現有行為。

---

## 目錄

1. [系統概述](#1-系統概述)
2. [整體架構](#2-整體架構)
3. [資料模型（Google Sheets）](#3-資料模型google-sheets)
4. [後端 API 規格](#4-後端-api-規格)
5. [前端頁面規格](#5-前端頁面規格)
6. [核心業務邏輯](#6-核心業務邏輯)
7. [排程任務（Cron）](#7-排程任務cron)
8. [外部整合](#8-外部整合)
9. [權限模型](#9-權限模型)
10. [部署與環境](#10-部署與環境)
11. [已知限制、技術債與未使用欄位](#11-已知限制技術債與未使用欄位)
12. [遺留檔案（不在使用中）](#12-遺留檔案不在使用中)

---

## 1. 系統概述

Pure Crochet 會員系統是一套**會員 + 活動報名 + 一對一教學預約**的輕量後台，讓會員透過 LINE 登入後：

- 查看/報名開放中的團體活動（含依會員等級的差異定價、自訂報名欄位、名額管理）
- 預約一對一教學課程（自助選時段，含前後緩衝時間邏輯）
- 查看自己的報名/消費/預約紀錄
- 自助申請成為會員（送出即生效，無需審核）

管理員（負責人）透過同一套帳號體系登入 `admin.html` 後台，可以：

- 管理會員資料、會員等級、一對一預約資格
- 建立/編輯/複製/刪除活動，設定差異化定價與自訂報名欄位（含選項圖片）
- 查看/管理報名名單（標記付款、刪除報名）
- 查看報名自訂欄位的統計（誰選了什麼、各選項幾人）
- 管理一對一預約設定與預約紀錄
- 收到新會員加入、新預約、活動前提醒等 LINE 推播通知

系統設計哲學（見專案 `CLAUDE.md`）：**目前只有負責人一個管理者**，直接控制所有寫入路徑；不刻意為「理論上會發生但實際不會發生」的情境加防呆或相容層。

---

## 2. 整體架構

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  瀏覽器 / LINE App 內建瀏覽器  │        │        LINE 平台                │
│  (LIFF app)                  │◄──────►│  - LINE Login（登入用頻道）      │
│                               │        │  - LINE Messaging API（推播用） │
│  docs/*.html + app.js         │        └──────────────────────────────┘
│  （GitHub Pages 靜態架站）      │
└──────────────┬───────────────┘
               │ POST JSON（action 分派）
               ▼
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Cloudflare Workers           │◄──────►│      Google Sheets API         │
│  worker/src/index.js          │        │  （唯一資料庫，服務帳號 JWT）    │
│  handleApiRequest 統一分派      │        └──────────────────────────────┘
│                               │
│                               │◄──────►│      Google Calendar API       │
│                               │        │  （團體活動+一對一預約輔助顯示） │
│                               │
│                               │◄──────►│      Cloudflare R2              │
│                               │        │  （活動封面圖/自訂欄位選項圖片） │
└─────────────────────────────┘
```

### 2.1 前端（`docs/`）

純靜態 HTML/CSS/JS，無建置工具、無框架，全部 vanilla JS，GitHub Pages 架站（`fitihuang/pure-crochet-member-system`，public repo）。

| 檔案 | 用途 |
|---|---|
| `index.html` | 會員主頁：我的資料、一對一預約、我的報名紀錄、依月份分區塊的開放報名活動列表、付款資訊 |
| `admin.html` | 管理後台：會員/活動/一對一預約管理，單頁但多個獨立卡片區塊 |
| `event.html` | 單一活動詳情頁（`?eventId=xxx`），可從這裡直接報名 |
| `admin-event-stats.html` | 單一活動的自訂報名欄位統計頁（`?eventId=xxx`），管理員專用 |
| `app.js` | 四個頁面共用的函式庫：`callApi`、LIFF 初始化、自訂 modal、日期格式化、自訂報名欄位的渲染/收集邏輯 |
| `favicon.png` / `images/golden_member.png` | 靜態圖片資源 |

**共用慣例**：CSS style 區塊在**每個 HTML 檔案裡各自重複一份**（不是共用檔案），JS 邏輯共用寫在 `app.js`。四個頁面都各自宣告 `var idToken`、`showApp`/`showLoading`/`showError` 這組樣板函式。

### 2.2 後端（`worker/`）

Cloudflare Workers，單一 Worker `pure-crochet-backend`，`worker/src/index.js` 的 `handleApiRequest` 以一個 `action` 字串統一分派到對應模組函式，**永遠回傳 JSON**（成功回傳資料本身，失敗回傳 `{ error: message }`，HTTP 狀態碼永遠是 200——錯誤是透過 body 裡的 `error` 欄位表達，不是 HTTP status）。

| 模組 | 職責 |
|---|---|
| `index.js` | 路由分派、CORS、cron 分流 |
| `auth.js` | 驗證 LINE ID Token、判斷是否為管理員 |
| `sheetsApi.js` | Google Sheets 的讀寫抽象層（含快取、日期序號轉換、批次讀取） |
| `googleAuth.js` | 用服務帳號金鑰簽發 JWT，換取 Google API access token |
| `members.js` | 會員 CRUD、自助申請、等級升等邏輯 |
| `events.js` | 活動 CRUD、名額計算、依等級定價 |
| `registrations.js` | 報名邏輯、自訂欄位加價計算、報名提醒、刪除報名 |
| `grades.js` | 會員等級查詢（唯讀） |
| `lessons.js` | 一對一預約的可預約時段計算、預約/取消/改期、課前提醒 |
| `settings.js` | 通用鍵值設定表讀寫 |
| `calendar.js` | Google Calendar 事件的建立/更新/刪除、忙碌時段查詢 |
| `imageUpload.js` | 圖片上傳到 R2、刪除 R2 圖片 |
| `lineMessaging.js` | LINE Messaging API 推播（給管理員、給單一會員） |
| `dateUtils.js` | 時區換算共用函式（Asia/Taipei） |

### 2.3 資料庫

**Google Sheets**，一份試算表（`SPREADSHEET_ID`），7 個分頁：`Members` / `Events` / `Registrations` / `Grade` / `Purchases` / `Settings` / `Lessons`。沒有真正的資料庫，所有查詢都是「整張表撈下來後在記憶體裡 `filter`/`find`」，沒有索引、沒有交易（transaction），靠 Workers 每次請求內的記憶體快取（`createSheetsClient` 內的 `rowsCache`）避免同一個請求內重複打 API。

服務帳號：`sheets-access@pure-crochet-backend.iam.gserviceaccount.com`，JWT scope 同時包含 `spreadsheets` 和 `calendar`。

### 2.4 圖片儲存

Cloudflare R2，bucket `pure-crochet-images`，透過 Worker binding `IMAGES_BUCKET` 存取，公開網址前綴 `https://pub-adbb4210febc453498def24e27ab01ce.r2.dev`。所有上傳圖片的 key 格式都是 `events/<timestamp>-<random6碼>.<副檔名>`（不分活動封面或自訂欄位選項圖片，同一個 prefix）。

### 2.5 LINE 整合（兩個獨立頻道）

- **LINE Login 頻道**：純登入用，透過 LIFF SDK（`liff.init`/`liff.login`/`liff.getIDToken`）取得 ID Token，後端呼叫 `https://api.line.me/oauth2/v2.1/verify` 驗證並取得 `sub`（LINE userId）。
- **LINE Messaging API 頻道**：`@qzj9528m` 官方帳號，用來主動推播訊息給管理員與會員。**這兩個頻道必須在同一個 LINE Developers Provider 底下**，否則同一個真人在兩邊會拿到不同的 userId（因為 LINE 的 userId 是以 Provider 為單位配發的），導致推播永遠找不到人（歷史上真的踩過這個坑，見第 11 節）。

---

## 3. 資料模型（Google Sheets）

以下是**目前實際存在**的欄位（2026-09 現況，透過讀取正式試算表確認），標註每欄的型別、意義、是否仍在使用。

### 3.1 `Members`（12 筆資料）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `會員ID` | 字串，格式 `M0001` | 主鍵，`generateNextId` 依現有最大號 +1 產生 |
| `LINE userId` | 字串 | LINE 的 `sub`，登入比對用，唯一 |
| `姓名` | 字串 | |
| `Email` | 字串 | 選填（跟手機至少填一個） |
| `手機` | 字串 | 選填；寫入時會被 `toWriteValue` 保護（開頭 `0` 的數字字串會被強制當文字，避免 Sheets 自動轉數字吃掉前導 0） |
| `累積付費活動次數` | 數字 | **非即時計算**，由每日排程 `runMemberUpgradeCheck` 重新統計寫回，平常讀 profile 是讀這個快取值 |
| `會員等級ID` | 字串，對應 `Grade.會員等級ID` | 一般由管理員手動指定；「金牌→榮譽」有一條自動升等路徑（見 6.4） |
| `加入日期` | 日期（`YYYY-MM-DD`） | |
| `一對一資格` | `是`/`否`/空 | 標註「本來就有聯繫過的固定學員」，可以跳過「必須先有一次由管理員建立的預約」門檻直接自助預約 |
| `審核狀態` | **已停用，欄位仍在但不再寫入/讀取** | 原本自助申請要走審核流程時用的欄位（值會是 `待審核`），2026-09 移除審核流程後，程式碼完全不再操作這個欄位，新申請的會員這欄永遠是空字串 |
| `LINE顯示名稱` | **未使用** | 為了「顯示會員 LINE 大頭貼/暱稱」這個構想預留的欄位，功能本身**尚未實作**（使用者確認過「先問問，不確定未來要使用」），目前沒有任何程式碼讀寫這欄 |
| `LINE大頭貼網址` | **未使用** | 同上 |

### 3.2 `Events`（5 筆資料）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `活動ID` | 字串，格式 `E0001` | 主鍵 |
| `活動名稱` | 字串 | |
| `活動日期` | 日期 | 單日活動，沒有多日活動的概念 |
| `報名截止日` | 日期 | **後台表單強制必填**；空白的話 `isRegistrationClosed` 的比較永遠不成立，活動會變成永遠開放報名（已知地雷，前端擋在表單層級） |
| `總名額` | 數字 | 目前**僅供顯示參考，不參與任何名額判斷邏輯**（真正卡關的是下面兩個保留名額欄位） |
| `VIP保留名額` | 數字 | 金牌會員專屬名額池 |
| `一般名額` | 數字 | 除了金牌會員以外**所有人共用**的名額池（含一般會員、榮譽會員） |
| `是否付費` | `是`/`否` | 只是活動列表的顯示標籤，**不是**金額計算的依據（金額計算一律看下面三個費用欄位算出來的實際金額是否 > 0） |
| `狀態` | `開放報名`/`已截止`/`已額滿` | 只有 `開放報名` 且日期未過的活動會出現在會員頁列表（`getEventList`）；`已截止`/`已額滿` 純粹是人工標記，不會被系統自動改變 |
| `活動內容` | 多行文字 | 活動詳情頁顯示，跟大綱一起呈現 |
| `活動封面圖片網址` | URL | 存在 R2 的公開網址 |
| `一般會員費用` | 數字 | |
| `金牌會員費用` | 數字 | |
| `榮譽會員費用` | 數字 | 2026-09 新增 |
| `開始時間` | 字串 `HH:MM` 或空白 | **空白代表「自由離席、時間彈性」，不是 bug** |
| `結束時間` | 字串 `HH:MM` 或空白 | 同上；`DATE_FIELDS` 全域名單命中這個欄位名，數字值會被自動當日期序號轉換（見 11.2） |
| `活動地點` | 字串 | |
| `活動地點地圖網址` | URL | 有填的話，地點會渲染成 Google Maps 連結 |
| `GoogleCalendar事件ID` | 字串 | 同步建立的 Calendar 事件 ID，用於後續更新/刪除；舊資料若沒有，`updateEvent` 會在下次更新時補建 |
| `活動大綱` | 多行文字 | 顯示在會員頁活動**列表**（比內容簡短的摘要） |
| `自訂欄位設定` | JSON 字串 | 詳見 6.3 |

### 3.3 `Registrations`（7 筆資料）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `報名ID` | 字串，格式 `R0001` | 主鍵 |
| `會員ID` | 字串 | 外鍵 → Members |
| `活動ID` | 字串 | 外鍵 → Events |
| `報名時間` | 日期時間 | |
| `報名時等級snapshot` | 字串，等級ID | **報名當下**的會員等級快照，跟「佔用名額類別」存同一個值但意義不同：這欄是歷史紀錄用途（例如自動升等判斷要看「當金牌會員期間」報名了幾次），另一欄是名額歸屬用途 |
| `佔用名額類別` | 字串，等級ID | 決定這筆報名算在 VIP 池還是一般池 |
| `是否付費` | `是`/`否` | **管理員在後台報名名單手動標記**，不是自動判斷；系統只有在建立報名時預設 `否` |
| `金額` | 數字 | 報名當下由後端權威計算並固定下來（基本費用 + 自訂欄位加購），之後不會因為活動改價而變動 |
| `使用的優惠券ID` | 字串 | **完全未使用的遺留欄位**，程式碼裡沒有任何優惠券相關邏輯（見 11.1） |
| `自訂欄位回覆` | JSON 字串 | 詳見 6.3 |
| `已提醒` | `是`/`否` | 活動前一天提醒推播用的去重旗標，新報名一律預設 `否` |

### 3.4 `Grade`（3 筆資料）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `會員等級ID` | 字串，格式 `G01` | 主鍵；**沒有 `createGrade` API**，等級是透過 ad-hoc 腳本直接寫入試算表建立的，後台沒有「新增等級」的 UI |
| `會員等級名稱` | 字串 | 目前是 `普通會員`（G01）／`金牌會員`（G02）／`榮譽會員`（G03）。**程式碼裡用等級「名稱」字串比對業務邏輯**（`getGradeIdByName(sheets, '金牌會員')`），不是看 ID，改名字會直接讓定價/名額/自動升等邏輯失效 |
| `徽章圖片網址` | URL，選填 | 有填的話會員頁會顯示圖片徽章，沒填則顯示文字底色標籤；圖片載入失敗會自動退回文字標籤（`onerror` fallback） |

### 3.5 `Purchases`（2 筆資料）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `消費ID` | 字串，格式 `P0001` | 主鍵 |
| `會員ID` | 字串 | 外鍵 |
| `消費日期` | 日期時間 | |
| `項目` | 字串 | 目前永遠是活動名稱（唯一寫入來源是報名流程），沒有其他消費類型 |
| `金額` | 數字 | |
| `關聯報名ID` | 字串 | 外鍵 → Registrations；刪除報名時會一併刪除對應這筆 |

**寫入時機**：只有 `runSubmitRegistration` 在「報名金額 > 0」時才會建立一筆（不是看活動的「是否付費」欄位，見 6.1 的地雷說明）。目前系統裡**沒有其他任何地方**會寫入 Purchases（一對一預約課程完全沒有對應的消費紀錄）。

### 3.6 `Settings`（9 筆資料，通用鍵值表）

`設定項目` / `內容` 兩欄，後台有對應表單可改（`saveLessonSettings`），不用手動去 Sheet 改。目前使用中的 key：

| 設定項目 | 用途 |
|---|---|
| `付款資訊` | 會員頁「付款資訊」卡片的內容，純文字 |
| `一對一可選時長分鐘` | 逗號分隔清單，例如 `60,120,180` |
| `一對一緩衝時間分鐘` | 每筆一對一預約前後都要留的緩衝時間 |
| `一對一預約開放時段起` / `一對一預約開放時段迄` | 每天可預約的時間窗 |
| `一對一課前提醒分鐘數` | 提前多久推播提醒管理員（不是提醒學員） |
| `負責人LINE聊天連結` | 學員第一次要自助解鎖預約前，私訊用的 LINE 官方帳號連結（`https://line.me/R/ti/p/@xxxxx` 格式） |
| `一對一課程報價` | 顯示在會員頁一對一預約區塊上方的說明文字（目前也是「終身免費陪打」這類非系統化權益的說明位置） |

### 3.7 `Lessons`（1 筆資料，一對一教學預約）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `預約ID` | 字串，格式 `L0001` | 主鍵 |
| `會員ID` | 字串 | 外鍵 |
| `預約日期時間` | 日期時間 | 開始時間 |
| `結束時間` | 日期時間 | |
| `狀態` | `已確認`/`已取消` | 取消是軟刪除（改狀態，不刪列） |
| `特殊留言` | 字串，選填 | |
| `GoogleCalendar事件ID` | 字串 | |
| `建立時間` | 日期時間 | |
| `已提醒` | `是`/`否` | 課前提醒去重旗標 |

**注意**：這張表**沒有金額欄位**，一對一預約在這個系統裡完全是「約時段」功能，不涉及金流／不會產生 Purchases 紀錄，報價說明純粹是 Settings 裡的一段文字，不是結構化資料。

---

## 4. 後端 API 規格

所有 API 都是打同一個端點：`POST https://pure-crochet-backend.pure-crochet.workers.dev`，body 是 JSON：`{ "action": "xxx", ...其他參數 }`，回傳一律是 JSON（成功回傳結果物件，失敗回傳 `{ "error": "錯誤訊息" }`）。

也支援 GET（帶 querystring），但**帶 `idToken` 的請求會被擋掉**（避免帶身份憑證的網址留在瀏覽器歷史/伺服器 log），只用於不需要登入的查詢（例如 `getEventList`）。

### 4.1 需要登入（`AUTH_REQUIRED_ACTIONS`，帶 `idToken`，後端會呼叫 LINE 驗證 API）

| action | 參數 | 權限 | 說明 |
|---|---|---|---|
| `getMemberProfile` | `idToken` | 任何已登入者 | 回傳會員完整檔案（見 4.3 詳細回傳格式） |
| `applyForMembership` | `idToken`, `memberData: {姓名, 手機, Email}` | 任何已登入者（且尚未是會員） | 自助建立會員資料，立即生效 |
| `getAllMembers` | `idToken` | 管理員 | 全部會員列表 |
| `createMember` | `idToken`, `memberData` | 管理員 | 後台手動新增會員 |
| `updateMember` | `idToken`, `memberId`, `memberData` | 管理員 | 更新任意欄位（direct pass-through，沒有欄位白名單） |
| `getAllEventsForAdmin` | `idToken` | 管理員 | 全部活動（含非開放中的） |
| `createEvent` | `idToken`, `eventData` | 管理員 | 新增活動 |
| `updateEvent` | `idToken`, `eventId`, `eventData` | 管理員 | 更新活動 |
| `deleteEvent` | `idToken`, `eventId` | 管理員 | 刪除活動（有報名紀錄的活動會被拒絕） |
| `submitRegistration` | `idToken`, `eventId`, `customFieldAnswers` | 任何已登入會員 | 報名活動 |
| `getEventRegistrationsForAdmin` | `idToken`, `eventId` | 管理員 | 單一活動的報名名單 |
| `updateRegistrationPayment` | `idToken`, `registrationId`, `isPaid` | 管理員 | 標記付款狀態 |
| `deleteRegistration` | `idToken`, `registrationId` | 管理員 | 刪除報名（連帶刪除關聯的 Purchases 紀錄） |
| `checkAllMembersUpgrade` | `idToken` | 管理員 | 手動觸發「重新計算累積付費活動次數」 |
| `uploadImage` | `idToken`, `base64Image`（data URL） | 管理員 | 上傳圖片到 R2，回傳公開網址 |
| `getAvailableLessonSlots` | `idToken`, `date` | 任何已登入者 | 查詢某天已被卡住的時段（含緩衝） |
| `bookLesson` | `idToken`, `date`, `startTime`, `durationMinutes`, `note` | 有資格的會員 | 自助預約一對一 |
| `cancelLesson` | `idToken`, `lessonId` | 本人或管理員 | 取消預約 |
| `getAllLessonsForAdmin` | `idToken` | 管理員 | 全部一對一預約列表 |
| `createLessonForMember` | `idToken`, `memberId`, `date`, `startTime`, `durationMinutes`, `note` | 管理員 | 幫學員手動建立第一筆預約（藉此解鎖該學員的自助預約資格） |
| `updateLessonTime` | `idToken`, `lessonId`, `date`, `startTime` | 管理員 | 改期（時長沿用原本的，不受目前可選時長清單影響） |
| `updateSettings` | `idToken`, `settingsData` | 管理員 | 更新 Settings 鍵值 |

### 4.2 不需要登入

| action | 參數 | 說明 |
|---|---|---|
| `getEventList` | 無 | 開放報名中、日期未過的活動列表（含即時計算的剩餘名額） |
| `getEventDetail` | `eventId` | 單一活動詳情（含即時剩餘名額），找不到會丟錯 |
| `getGradeList` | 無 | 全部會員等級（含徽章圖片網址） |
| `getSettings` | 無 | 全部 Settings 鍵值 |

### 4.3 `getMemberProfile` 回傳格式詳解

這是系統裡**呼叫最頻繁、回傳格式最多分支**的 API：

```
// 情境 1：這個 LINE 帳號完全查無會員資料
{ needBinding: true, isAdmin: boolean }

// 情境 2：正常會員（不管是否為管理員）
{
	memberId, name, email, phone, paidCount,
	grade: { 會員等級ID, 會員等級名稱, 徽章圖片網址 } | null,
	registrations: [...],  // 見下方
	purchases: [...],
	isAdmin: true,         // 只有 true 時才會出現這個欄位，不是管理員就完全不帶
	// 以下由 index.js 額外 merge 進來（只要 !needBinding 就會呼叫 getLessonBookingInfo）：
	canBookLesson, lessonCount, lineContactUrl, durationOptions, priceInfo, myLessons
}
```

`registrations` 陣列裡每筆物件除了 Registrations 原始欄位，還會被 `members.js` 補上 `活動名稱`／`活動日期`（從 Events 查來的，活動被刪掉的話退回顯示活動ID/null）。

**沒有 `pendingReview` 分支**——2026-09 移除審核流程後，只要建立了 Members 資料列就直接視為正式會員。

### 4.4 錯誤處理慣例

- 所有 action 函式用 `throw new Error('中文錯誤訊息')`，`index.js` 的 `fetch` handler 統一 catch 起來包成 `{ error: err.message }`。
- 前端 `app.js` 的 `callApi` 看到 `result.error` 就 `throw new Error(result.error)`，交給呼叫端的 `.catch()` 處理（通常是 `appAlert(err.message)`）。
- 特例：`需要登入` 和 `LINE token 驗證失敗` 這兩個錯誤訊息會被 `isAuthExpiredError` 攔截，觸發 `handleAuthExpired()`（見 5.1），不會走一般錯誤處理路徑。

---

## 5. 前端頁面規格

### 5.1 共用機制（`app.js`）

- **`callApi(action, params)`**：`fetch` 包裝，POST JSON，`Content-Type: text/plain;charset=utf-8`（刻意不用 `application/json`，避免瀏覽器對這類跨網域請求送出 preflight OPTIONS）。回應如果不是合法 JSON（Workers 偶發回傳異常內容），丟出「請確認操作是否已成功執行」的訊息，**不自動重試**（避免新增/修改類操作被重試造成重複寫入）。
- **登入態過期處理**：`isAuthExpiredError` 判斷錯誤訊息是不是登入相關，是的話呼叫 `handleAuthExpired()` → `liff.logout()` + 彈窗提示 + 呼叫該頁面的 `showLoginScreen()`（若存在）或整頁重新整理，並回傳一個永遠不 resolve 的 Promise，讓呼叫端原本的 `.then()` 鏈不會繼續執行。LIFF ID Token 效期約 1 小時，過期後無法靜默換發，只能請使用者重新登入。
- **自訂 Modal 系統**：`showAppModal`/`appAlert`/`appConfirm`，取代原生 `alert`/`confirm`（原生對話框無法客製化標題，一定會顯示「網址 says」）。標題固定顯示「Pure Crochet 會員系統 提醒」。
- **`openExternalUrl(url)`**：在 LIFF 內建瀏覽器環境下用 `liff.openWindow({external:true})` 開啟外部連結（例如私訊官方帳號），一般瀏覽器則用 `window.open`——因為在 LINE App 內建瀏覽器裡，普通的 `<a target="_blank">` 常常只是換到另一個內嵌網頁，不會真的跳轉。
- **自訂報名欄位渲染邏輯**（`buildCustomFieldsFormHtml`/`collectCustomFieldAnswers`/`updateCustomFieldsEstimate`）：詳見 6.3。

### 5.2 `index.html`（會員主頁）

**初始化流程**：`initLiff()` → 已登入就 `loadProfile()`（平行打 `getMemberProfile`/`getEventList`/`getSettings`），未登入顯示登入畫面。

**頁面狀態機**（`renderProfile` 的分支）：

1. `profile.needBinding === true` → `renderNeedBindingScreen()`：這組 LINE 帳號查無會員資料。**特意跟「未登入」的 `showLoginScreen()` 分開**，不然使用者已經登入卻查無資料時，畫面長得跟登入前一樣，會誤以為「登入沒生效」而卡住。提供「填資料申請加入」連結跟「登出換帳號」按鈕。
2. 正常會員 → 依序渲染：我的資料卡片（含金牌會員專屬徽章圖，`images/golden_member.png`，130×130px，右上角絕對定位）→ 一對一預約卡片 → 我的報名紀錄卡片（分頁，每頁 5 筆）→ 依月份分區塊的開放報名活動列表 → 付款資訊卡片 → （管理員才有）前往後台卡片。

**開放報名活動列表**：**沒有月曆格子 UI**（2026-09 移除），直接把 `getEventList` 回傳的活動依日期排序後按「年-月」分組，每個月份各自一張 `.card`，標題是「YYYY年M月開放報名活動」。活動卡片（`renderEventCard`）顯示：封面縮圖、名稱、依會員等級算出的價格（`getDisplayPrice`）、日期時間、報名截止日、地點（有地圖網址就是連結）、大綱、報名按鈕（已報名/已額滿會 disable）、查看詳情連結。

**一對一預約區塊**（`renderLessonCard`）：
- 若 `!canBookLesson`：顯示「請先私訊我們約時間」+ 私訊按鈕（`openExternalUrl`）。
- 若可自助預約：時長下拉選單 + 日期選擇（`min` 是今天）+ 時間輸入。選日期後打 `getAvailableLessonSlots` 顯示這天已被卡住的時段（含緩衝，`buildLessonAvailabilityInfoHtml`），選時間後前端即時檢查是否落在營業時段內、有沒有跟卡住的區間重疊（`onLessonTimeChange`），通過才出現「確認預約」按鈕。
- 下方永遠顯示「我的一對一紀錄」列表，未來且已確認的可以取消。

**申請加入會員**（`renderApplyForm`/`submitApplication`）：純表單（姓名必填、手機或 Email 至少一個），送出後**立即**呼叫 `applyForMembership` 並 `loadProfile()` 刷新——沒有等待審核的中繼畫面。

### 5.3 `admin.html`（管理後台）

單頁多卡片結構，登入後 `checkAdminAccess()` 檢查 `profile.isAdmin`，不是的話直接顯示「你沒有管理後台的權限」（不會嘗試顯示其他任何內容）。

**四大卡片區塊**（依序）：

1. **會員管理**：新增/編輯表單（姓名、Email、手機、等級下拉、一對一資格 checkbox）+ 會員列表（顯示等級標籤、一對一資格標籤、付費次數）+「重新計算付費次數」按鈕（手動觸發 `checkAllMembersUpgrade`）。
2. **活動管理**：新增/編輯/複製表單（詳見 6.5）+ 自訂報名欄位編輯器（詳見 6.3）+ 活動列表（每筆有編輯/複製/報名名單/欄位統計連結（有自訂欄位才顯示）/刪除五個動作）。
3. **報名名單區塊**（`#registrationSection`，預設隱藏，點「報名名單」才顯示並捲動過去）：顯示某活動的所有報名（姓名、付費標籤、佔用類別、報名時間、金額、自訂欄位回覆），每筆可以「標記已付費/未付費」跟「刪除」（刪除前彈確認，說明會連動刪除消費紀錄且不可復原）。
4. **一對一預約管理**：預約設定表單（可選時長/緩衝時間/開放時段/提醒分鐘數/私訊連結/報價說明，對應 Settings）+ 手動建立預約表單（用來解鎖學員的自助預約資格）+ 預約列表（可修改時間/取消）。

**活動表單的「複製」功能**（2026-09 新增）：`renderEventForm(event, forceNew)` 第二個參數為 `true` 時，表單欄位會用來源活動的值預填，但存檔時當新活動處理（`saveEvent(null)`），狀態強制重設回「開放報名」（不繼承已截止/已額滿）。標題會顯示「新增活動（複製自「原活動名稱」）」。

### 5.4 `event.html`（活動詳情頁）

`?eventId=xxx` query string 決定顯示哪個活動。未登入先顯示登入畫面，登入後平行打 `getEventDetail` + `getMemberProfile`。顯示內容跟會員頁的活動卡片類似但更完整（大綱+內容都顯示、封面圖更大張）。報名按鈕邏輯：`needBinding` 顯示「請先完成帳號綁定」、已報名/已額滿分別 disable，否則可報名（會跳出自訂欄位表單，同 `showRegistrationForm`）。報名成功後導回 `index.html`。

### 5.5 `admin-event-stats.html`（自訂欄位統計，2026-08 新增）

`?eventId=xxx`，管理員專用（`getMemberProfile` 確認 `isAdmin`）。對每個自訂欄位：
- `select`/`checkbox` 類型：列出每個選項有幾人選、是哪些會員（姓名逗號分隔），加一列「未填寫」統計沒回答這題的人。
- `text` 類型：沒有選項可統計，直接列出「姓名：填寫內容」。

從 `admin.html` 活動列表的「欄位統計」連結（`target="_blank"`）進入，只有設定了自訂欄位的活動才會出現這個連結。

---

## 6. 核心業務邏輯

### 6.1 活動報名金額計算（權威來源在後端，前端只是預覽）

```
基本費用 = getEventPriceForGrade(event, 會員當下的等級ID)
         → 金牌會員費用 / 榮譽會員費用 / 一般會員費用（三選一，依等級名稱字串比對）

加購金額 = calculateCustomFieldsAddonPrice(event, 前端送來的答案)
         → 重新解析 event 當下的「自訂欄位設定」JSON，
           依答案裡選到的選項標籤，逐一比對回該欄位定義裡的 price 加總
         → 任何前端傳來、對不上目前欄位定義的答案都直接忽略（防竄改）

最終金額 = 基本費用 + 加購金額
```

**前端絕對不會被信任**：即使有人竄改瀏覽器送出的 `customFieldAnswers` 夾帶不存在的選項或直接偽造金額，後端一律無視送來的金額、只用當下的活動定義重算。

**地雷**：「是否建立 Purchases 紀錄」看的是**重算出來的 `price > 0`**，不是活動的「是否付費」欄位——因為免費活動如果自訂欄位裡有加價選項，一樣要收錢、要留紀錄，若只看活動層級的「是否付費」會漏記。

### 6.2 活動名額判斷

二元池設計，**沒有第三個獨立的「榮譽會員池」**：

```
quotaField = (該會員的等級ID === 金牌會員ID) ? 'VIP保留名額' : '一般名額'
usedCount  = 該活動下「佔用名額類別」等於該會員等級ID 的報名筆數
if usedCount >= event[quotaField] → 報名時丟錯「該類別名額已滿」
```

榮譽會員報名時，`gradeId !== 金牌會員ID`，所以自動落入「一般名額」池，跟一般會員共用名額——這是刻意的設計決定（曾評估過拆第三桶，使用者選擇不拆，理由是簡化範圍）。

活動列表/詳情頁顯示的「VIP剩餘名額」「一般剩餘名額」是**即時計算**（`decorateEventWithRemainingQuota`，每次查詢都重新掃 Registrations 算），不是快取值。

### 6.3 自訂報名欄位（活動的 `自訂欄位設定` / 報名的 `自訂欄位回覆`）

**欄位定義格式**（存在 Events 的 `自訂欄位設定`，JSON 字串）：

```json
[
	{
		"type": "select",          // select（下拉單選）| checkbox（多選）| text（自由留言）
		"label": "顏色選擇",
		"options": [                // 只有 select/checkbox 才有 options
			{ "label": "奶茶色", "price": 0, "imageUrl": "" },
			{ "label": "灰藍色", "price": 50, "imageUrl": "https://pub-xxx.r2.dev/events/xxx.jpg" }
		]
	}
]
```

`options` 裡每一項是獨立物件（後台是一個選項一列，各自的名稱/加價金額/參考圖片輸入框，「＋新增選項」逐一新增，不是逗號分隔字串解析）。儲存時（`saveEvent`）會過濾掉標題留空的欄位、名稱留空的選項。

**答案格式**（存在 Registrations 的 `自訂欄位回覆`，JSON 字串）：`{ "欄位標題": "選中的選項標籤字串" | ["多選的標籤字串陣列"] }`，`select`/`text` 是字串、`checkbox` 是陣列，沒填的欄位完全不會出現在物件裡（不會是 `null`/`""`）。

**選項參考圖片對渲染方式的影響**：原生 `<select><option>` 跟純文字 checkbox 都沒辦法在選項裡放圖片。只要某個欄位的任一選項有 `imageUrl`，報名表單就會改用「圖卡式」版面（`buildOptionImageCardsHtml`）：
- `select` 類型改成一組 `radio`（同一個 `name`，單選語意用原生 radio 互斥保證）。
- `checkbox` 類型維持獨立 `checkbox`，只是外觀包成卡片。
- 沒有任何選項帶圖片的欄位，維持原本的原生 `<select>`/純文字 checkbox 清單，不受影響。

`collectCustomFieldAnswers`/`updateCustomFieldsEstimate` 都要分別處理「原生 select」跟「圖卡式 radio」兩種讀值路徑（用 `fieldHasOptionImages(field)` 判斷走哪一條）。

### 6.4 會員等級與自動升等

三個等級：`普通會員`（預設）／`金牌會員`／`榮譽會員`。**等級異動預設完全人工**（管理員在會員編輯表單手動選），唯一的例外：

```
每日排程 checkHonorMemberUpgrades：
  找出所有目前等級 = 金牌會員 的會員
  對每個人：算「報名時等級snapshot = 金牌會員ID」且「是否付費 = 是」的報名筆數
  >= 3 筆 → 自動把 會員等級ID 改成 榮譽會員ID
```

刻意用「報名時等級snapshot」而不是「累積付費活動次數」，是為了只算**當金牌會員期間**報名的付費活動，不會把當一般會員時期繳的費也算進資格門檻。這條自動升等只走「金牌→榮譽」單一方向，不會影響其他等級異動，也**不會發送任何 LINE 通知**（使用者明確要求不做，理由是升等仍仰賴管理員手動確認付款狀態，不是真的全自動）。

「榮譽會員報名滿 3 次付費活動可終身免費陪打」這個權益**完全沒有系統化實作**，純粹是 Settings 的「一對一課程報價」文字說明裡的一段文案，沒有資格判斷、沒有預約系統整合。

### 6.5 活動複製（2026-09 新增）

後台「複製」按鈕把來源活動的所有欄位（含自訂報名欄位/選項圖片網址）當草稿帶入新增活動表單，**狀態強制重設為「開放報名」**（不繼承已截止/已額滿），存檔時走 `createEvent`（新的活動ID、新的 Calendar 事件），完全不影響原活動。封面圖片網址若原封不動複製，兩個活動會共用同一張 R2 圖片（不會重新上傳一份），這是刻意的行為，不是 bug——只要之後沒有人手動把某一邊的圖換掉/刪除該活動，就不會出問題。

### 6.6 一對一預約的可預約時段與緩衝邏輯

不是固定間隔的時段選單，而是「自由輸入時間 + 即時檢查」：

1. 同一天如果有**任何狀態**的團體活動，這天**整天**不開放一對一預約（`hasActivityOnDate`）。
2. 後端把「這天所有忙碌區間」（Google Calendar freeBusy API 查出的既有一對一課+負責人其他行程）**各自往前後擴張緩衝時間**，回傳給前端顯示成「已被預約的時段（含緩衝）」清單。
3. 前端選時間時，即時檢查所選時段是否落在營業時段內、有沒有跟上述擴張後的區間重疊。
4. **下單前後端會重新查一次**忙碌區間再次驗證（`createLessonInternal`），避免極短時間內兩人搶到緩衝範圍內的時段——這是唯一真正防止 race condition 的地方，前端的即時檢查純粹是 UX 優化。

緩衝時間的數學：`busyStart - buffer` 到 `busyEnd + buffer` 視為不可用區間，新預約的 `[start, end]` 只要跟任一個擴張後的區間有交集就擋掉，等同保證任兩筆預約之間的間隔一定 ≥ buffer。

改期（`updateLessonTime`）**不改時長**，沿用原本預約的時長（用結束時間減開始時間反推），不受目前 Settings 裡可選時長清單變動的影響；改期後會重設 `已提醒` 為 `否`，避免用舊時間算出的提醒視窗漏發。

---

## 7. 排程任務（Cron）

`wrangler.toml` 設定三組 UTC cron，`index.js` 的 `scheduled` handler 依 `event.cron` 字串分流：

| Cron（UTC） | 對應台北時間 | 觸發的邏輯 |
|---|---|---|
| `0 18 * * *` | 隔天凌晨 2:00 | `runMemberUpgradeCheck`（重算累積付費活動次數）+ `checkHonorMemberUpgrades`（金牌滿3次自動升等榮譽） |
| `0 1 * * *` | 上午 9:00 | `sendUpcomingEventReminders`（推播提醒明天有活動的報名者，**刻意跟凌晨那組分開**，不然使用者半夜收到通知很奇怪） |
| `*/15 * * * *` | 每 15 分鐘 | `sendUpcomingLessonReminders`（在課前提醒時間窗內，推播提醒**管理員**——不是學員本人——即將開始的一對一課） |

三組任務彼此獨立，互不依賴執行順序。

---

## 8. 外部整合

### 8.1 LINE Login（LIFF）

- LIFF App 設定：Size = Full，Endpoint URL = `https://fitihuang.github.io/pure-crochet-member-system/`，Scope = `openid`（沒有勾 `profile`，因為系統沒有使用大頭貼/顯示名稱功能）。
- 前端 `liff.login()` **一定要明確傳 `redirectUri: location.href`**——不傳的話會預設導回 LIFF App 的註冊 Endpoint URL，不是使用者原本在的頁面（歷史上踩過的坑：`admin.html` 登入完被彈回 `index.html`）。
- 後端驗證：`POST https://api.line.me/oauth2/v2.1/verify`，帶 `id_token` + `client_id`（`LINE_LOGIN_CHANNEL_ID`），成功會拿到 `sub` 當作 `lineUserId`。
- **userId 是 Provider 級別的**：同一個真人在不同 Provider 底下的 Login 頻道會拿到不同的 `sub`。Login 頻道換過 Provider，所有既有會員的 `LINE userId` 都會作廢，需要手動把新的 `sub` 接回原本的會員資料（而不是讓對方走自助申請流程重新開一筆，會遺失歷史紀錄）。

### 8.2 LINE Messaging API

- 官方帳號 `@qzj9528m`，跟 LINE Login **必須在同一個 Provider**（見 2.5）。
- 只使用單一對象的 `POST https://api.line.me/v2/bot/message/push` API，**完全沒有用到 broadcast/multicast API**，不存在「意外推播給所有加好友的人」的風險——每次呼叫都必須帶明確的單一 `to: <userId>`。
- 兩種推播情境：
  - `pushMessageToAdmin`：迴圈跑過 `ADMIN_LINE_USER_IDS`（逗號分隔），每個都各自呼叫 `pushMessageToUser`。目前用於：新會員加入、新的一對一預約、一對一預約取消、一對一課前提醒。
  - 對會員本人的推播：報名成功通知（含金額與繳費確認提醒）、活動前一天提醒。
- 推播失敗（例如對方沒加好友）只 `console.log`，**不會拋出例外**，不會擋到主要的 Sheets 寫入操作。

### 8.3 Google Calendar

- 團體活動跟一對一預約都會同步建立/更新/刪除對應的 Calendar 事件，純輔助顯示 + 一對一時段的 `freeBusy` 判斷用。
- 團體活動：有開始時間就建時段事件，沒有就建全天事件（全天事件的結束日期要用純日曆算術 +1 天，Google Calendar 全天事件慣例是「不含」結束日）。
- 同步失敗（`syncCreateToCalendar`/`syncUpdateToCalendar`/`syncDeleteFromCalendar`）一律 try/catch 吞掉只 log，不擋主要操作。
- 忙碌時段查詢（`getBusyTimes`）用 `freeBusy` API，只查 `env.CALENDAR_ID` 這一個行事曆。

### 8.4 Cloudflare R2

- 圖片上傳唯一入口：`uploadImageToR2`（管理員限定），接受 data URL 格式的 base64 圖片，key 格式 `events/<timestamp>-<random>.<ext>`。
- 換活動封面圖或刪除活動時，會呼叫 `deleteImageFromR2` 清掉舊圖，避免免費額度被用不到的圖片慢慢吃掉——但自訂欄位選項圖片**沒有對應的清理邏輯**（見 11.3）。

---

## 9. 權限模型

只有兩種角色，沒有更細緻的分級：

- **一般會員**：`getMemberProfile` 回傳裡沒有 `needBinding`、`isAdmin` 也不是 `true`。可以報名活動、預約一對一、看自己的資料，不能碰任何 `*ForAdmin`/`create*`/`update*`（會員自己資料除外，且會員本人**沒有**自己改自己資料的 API，只能改姓名/手機/Email 以外不行——實際上目前系統連會員自己編輯資料的入口都没有，只有管理員能改）。
- **管理員**：由 Cloudflare Worker secret `ADMIN_LINE_USER_IDS`（逗號分隔的 LINE userId 清單）決定，**跟有沒有 Members 資料列完全無關**——這是刻意設計，避免管理員自己還沒綁定會員資料時被擋在後台外。每個需要管理員權限的 action 函式自己在最前面 `if (!auth.isAdmin) throw new Error('沒有權限')`，不是靠一個外層的路由層 middleware 統一擋。

**沒有欄位層級的權限控制**：`updateMember`/`updateEvent` 這類函式是直接把前端傳來的整包 `memberData`/`eventData` object 做 `Object.assign`/`updateRowFromObject`，沒有欄位白名單——這在「只有負責人一個管理者」的前提下是可接受的，但如果之後要開放給更多管理員或角色分級，這裡需要重新設計。

---

## 10. 部署與環境

### 10.1 後端部署

```bash
cd worker && npx wrangler deploy
```

Worker secrets（`wrangler secret put <NAME>`，寫入後無法讀回值，只能 `wrangler secret list` 看名稱）：

| Secret | 用途 |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | 服務帳號 JSON 金鑰（完整內容），簽發 JWT 用 |
| `SPREADSHEET_ID` | 試算表 ID |
| `CALENDAR_ID` | Google Calendar ID |
| `LINE_LOGIN_CHANNEL_ID` | LINE Login 頻道 ID（驗證 token 時當 `client_id`），非機密，公開的用戶端識別碼 |
| `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` | Messaging API 的推播權杖，**真正的機密憑證** |
| `ADMIN_LINE_USER_IDS` | 管理員的 LINE userId 清單，逗號分隔 |

本機開發用 `worker/.dev.vars`（同樣的 key，明文存放，`.gitignore` 排除，不進 repo）；ad-hoc 測試腳本都是直接讀這個檔案取得憑證，對正式 Sheets/Calendar 做真實讀寫。

### 10.2 前端部署

改 `docs/*.html`／`docs/app.js` 後直接 `git push` 到 `main`，GitHub Pages 自動建置：

```bash
gh api repos/fitihuang/pure-crochet-member-system/pages/builds/latest --jq '.status'
```

**快取地雷**：GitHub Pages 對 `.html`/`.js` 設 `cache-control: max-age=600`（10 分鐘），改完 push 後在瀏覽器測試（就算開新分頁）也可能吃到舊版。驗證方式：`curl` 直接看原始檔，或網址加 `?cachebust=1` 之類的 query string 強制略過快取。

### 10.3 上線網址

| 用途 | 網址 |
|---|---|
| 會員頁 | `https://fitihuang.github.io/pure-crochet-member-system/` |
| 活動詳情 | `https://fitihuang.github.io/pure-crochet-member-system/event.html?eventId=xxx` |
| 管理後台 | `https://fitihuang.github.io/pure-crochet-member-system/admin.html` |
| 欄位統計 | `https://fitihuang.github.io/pure-crochet-member-system/admin-event-stats.html?eventId=xxx` |
| 後端 API | `https://pure-crochet-backend.pure-crochet.workers.dev` |

### 10.4 帳號權責現況

Google/GitHub/Cloudflare 帳號目前都掛在系統開發者本人名下，**尚未正式移交給負責人**（品牌實際經營者）；LINE 官方帳號 `@qzj9528m` 則是負責人自己的 Provider，開發者以 Admin 角色被加進去操作。這個「帳號分散在不同人名下」的現況本身沒有造成功能性問題，但代表：
- 系統開發者若要交接/離開，需要走「移交存取權」的流程，目前偏向討論但尚未拍板執行。
- Worker/Sheets/Calendar/GitHub Pages 這幾個帳號的存取權跟 LINE Provider 的存取權是分開管理的，不是同一組憑證。

---

## 11. 已知限制、技術債與未使用欄位

### 11.1 完全未使用的欄位/功能

- **`Registrations.使用的優惠券ID`**：整個程式碼庫沒有任何優惠券邏輯，這欄位是舊系統（Apps Script 時代）的遺留欄位，純資料庫層面殘留，跟現行功能無關。
- **`Members.LINE顯示名稱` / `Members.LINE大頭貼網址`**：為了「顯示會員 LINE 暱稱/大頭貼」構想預留的欄位，功能本身從未實作（使用者主動喊停："先問問，不確定未來要使用"）。目前 `auth.js` 驗證 LINE token 時也只取用 `sub`，沒有要求 `profile` scope，就算想做也要先補這個 scope。
- **`Members.審核狀態`**：2026-09 移除自助申請審核流程後的死欄位，程式碼不再讀寫，但欄位本身還留在 Sheet 上（沒有刪除既有欄位，只是不再使用）。
- **`終身免費陪打`**：只是 Settings 文字說明裡的一句話，沒有任何系統化的資格追蹤或預約整合。

### 11.2 Sheets 寫入的隱性風險

- `DATE_FIELDS` 是**全域欄位名單**，不分是哪張表——只要欄位名字命中（例如 `結束時間`），不管是 Events 的還是 Lessons 的都會套用「數字→日期序號」轉換邏輯。新增欄位時如果剛好撞名要注意。
- 任何**不透過** `appendRowFromObject`/`updateRowFromObject`（或間接透過 `updateSettings`）寫入 Sheets 的路徑（例如 ad-hoc 補欄位腳本直接打原始 Sheets API），都**不會**套用 `toWriteValue` 的文字保護，手機號碼、`"10:00"` 這類字串會被 Sheets 自動轉型壞掉。歷史上真的發生過一次（見專案 `CLAUDE.md`）。
- Sheets 沒有交易概念，`deleteRegistration` 這類「刪兩張表」的操作如果中途失敗（例如刪了 Purchases 後刪 Registrations 失敗），會留下不一致狀態，目前沒有補償機制。

### 11.3 活動複製與圖片共用

複製活動時，封面圖片網址跟自訂欄位選項的圖片網址都是直接複製字串（同一個 R2 物件被兩個活動共用），**沒有重新上傳一份**。這代表：如果之後刪除其中一個活動（`deleteEvent` 會呼叫 `deleteImageFromR2`），另一個活動如果還在用同一張圖，圖片就會失效——目前完全沒有「這個 R2 物件是否還有其他活動在引用」的參照計數機制。實務上因為只有負責人一個人操作，這個風險目前被視為可接受。

### 11.4 名額/金額欄位的隱性耦合

- `Events.總名額` 目前**沒有任何程式邏輯讀它**，純粹是後台輸入時給人看的參考數字，跟 VIP/一般兩個保留名額欄位不會自動加總校驗（管理員可以填出總名額 ≠ VIP+一般 的資料，系統不會擋）。
- 等級相關的業務邏輯（定價三選一、VIP 名額池判斷、自動升等）全部用**等級名稱字串**（`'金牌會員'`、`'榮譽會員'`）比對，不是用等級 ID。如果哪天在後台把 Grade 的名稱改掉，這些邏輯會全部失效但不會有任何錯誤訊息提示——名稱比對不到就默默落入「一般」分支。

### 11.5 沒有分頁/搜尋機制

`getAllMembers`/`getAllEventsForAdmin`/`getAllLessonsForAdmin` 全部是整表撈回來，前端直接全部渲染，沒有分頁、排序、篩選（除了報名紀錄卡片有簡單分頁）。目前資料量小（會員十餘筆、活動個位數）不是問題，但不是為規模化設計的架構。

### 11.6 測試策略

沒有自動化測試套件（unit test / integration test framework）。後端邏輯的驗證方式是寫 ad-hoc Node 腳本，用真實服務帳號憑證直接對正式 Google Sheets/Calendar 讀寫驗證，測完手動清理測試資料；前端邏輯用瀏覽器注入測試資料呼叫 render 函式驗證（因為 LINE OAuth 登入無法在自動化瀏覽器裡完成，無法端到端測試登入流程本身）。

---

## 12. 遺留檔案（不在使用中）

repo 根目錄下還留著 2026-07 遷移前的 **Google Apps Script** 版本原始碼，**已被 Cloudflare Workers 版本完全取代，目前沒有部署、不影響線上系統**：

```
Code.gs / Events.gs / Grades.gs / Members.gs / Registrations.gs / Settings.gs / Test.gs / Triggers.gs / Utils.gs
appsscript.json / .clasp.json
```

（`Auth.gs`／`ImageUpload.gs` 因含金鑰/個資已被 `.gitignore` 排除，不在 repo 裡，但本機還留著。）

這些檔案保留只是歷史參考，**改動系統邏輯一律只改 `worker/src/*.js`**，不需要也不應該同步修改這些 `.gs` 檔案。
