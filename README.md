# 羽球團管理系統 — Google Drive Excel 版

這一版刻意做成與 `homestay-housekeeping` 相同概念：

- GitHub Pages：放 PWA 前端
- IndexedDB：手機本機資料
- Google Identity Services：Google 授權
- Google Drive API：在 Google 雲端硬碟建立/更新檔案
- SheetJS：在瀏覽器直接產生真正的 `.xlsx`
- Google Drive 會建立：

```text
羽球團管理系統備份/
├─ 羽球團_完整紀錄.xlsx
└─ 羽球團_系統還原備份.json
```

**完全不需要 Supabase、Google Sheets 或 Apps Script。**

---

## 已完成的功能

- PWA，可加入 iPhone / Android 主畫面
- 今日球局一鍵建立
- 出席大按鈕勾選
- 勾選後自動記帳
- 取消勾選會自動作廢該次球費
- 預設 2 桶 × $700
- 固定每人扣 $350
- 可切換「依實際出席人數平均分攤」
- 團員季繳 / 儲值 / 餘額
- 手動餘額調整
- 球桶庫存與進貨成本
- 流水帳
- 每筆操作記錄管理者名稱
- Google Drive Excel＋JSON 同步
- 雲端 JSON 合併後再產生 Excel
- 本機 Excel / JSON 下載
- 從 Google Drive JSON 完整還原

---

# 第 1 步：上傳 GitHub

建立一個新的 GitHub Repository，例如：

```text
badminton-club-manager
```

把 ZIP 解壓縮後，將以下內容全部放到 Repository 根目錄：

```text
index.html
manifest.webmanifest
sw.js
css/
js/
icons/
README.md
```

接著：

```text
GitHub Repository
→ Settings
→ Pages
→ Build and deployment
→ Deploy from a branch
→ Branch: main
→ /(root)
→ Save
```

完成後網址通常會像：

```text
https://你的帳號.github.io/badminton-club-manager/
```

---

# 第 2 步：建立 Google Cloud Project

前往 Google Cloud Console。

建立一個 Project，例如：

```text
Badminton Club Manager
```

---

# 第 3 步：開啟 Google Drive API

在 Google Cloud Project 裡：

```text
APIs & Services
→ Library
→ 搜尋 Google Drive API
→ Enable
```

這個 App 不是用 Google Sheet API，而是直接用 Google Drive API 建立 `.xlsx` 與 `.json`。

---

# 第 4 步：設定 Google OAuth

到 Google Cloud 的 Google Auth Platform。

設定 Branding / OAuth consent screen：

- App name：羽球團管理系統
- User support email：你的 Gmail
- Developer contact：你的 Gmail

如果目前是 Testing 模式，請把你要使用的 Google 帳號加入 Test users。

如果兩位管理者要使用同一份 Drive 資料，我建議建立一個專用帳號，例如：

```text
mybadmintonclub@gmail.com
```

兩台手機都連這一個 Google Drive 帳號，會最簡單。

---

# 第 5 步：建立 OAuth Client ID

到：

```text
Google Auth Platform
→ Clients
→ Create Client
→ Application type: Web application
```

名稱例如：

```text
Badminton PWA
```

## Authorized JavaScript origins

如果你的 GitHub Pages 是：

```text
https://shawn0827.github.io/badminton-club-manager/
```

Origin 請填：

```text
https://shawn0827.github.io
```

注意：**不要加 Repository 路徑，也不要加最後斜線。**

建立完成後會得到：

```text
1234567890-xxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

這就是 OAuth Client ID。

---

# 第 6 步：第一次開啟 App

打開 GitHub Pages 網址。

進：

```text
設定
→ Google Drive Excel
```

填入：

### Google OAuth Client ID

貼上剛才建立的 Client ID。

### 這台裝置的管理者名稱

例如：

```text
Shawn
```

另一位管理者可以填自己的名字。

### Google Drive 資料夾名稱

預設：

```text
羽球團管理系統備份
```

建議不要改。

按：

```text
儲存設定
```

再按：

```text
連接 Google
```

Google 會要求 Drive 授權。

授權完成後，系統會立即第一次同步。

---

# 第 7 步：確認 Google Drive

到 Google Drive 應該會看到：

```text
羽球團管理系統備份/
```

裡面有：

```text
羽球團_完整紀錄.xlsx
羽球團_系統還原備份.json
```

Excel 工作表包含：

- 營運總覽
- 團員餘額
- 球局紀錄
- 出席明細
- 流水帳
- 球桶庫存
- 設定

---

# Excel 和 JSON 各自做什麼？

## Excel

```text
羽球團_完整紀錄.xlsx
```

用途：

- 直接在 Google Drive 看帳
- 下載 Excel
- 篩選紀錄
- 對帳
- 留存

**App 不會把你手動修改 Excel 的內容讀回系統。**

## JSON

```text
羽球團_系統還原備份.json
```

這才是 App 的完整雲端同步 / 還原資料。

因此不要手動修改 JSON。

---

# 兩位管理者怎麼使用？

最簡單：

```text
同一個 GitHub Pages App
＋
同一個羽球團專用 Google 帳號
```

管理者 A：

```text
管理者名稱：Shawn
```

管理者 B：

```text
管理者名稱：管理者B
```

兩台裝置第一次都連到同一個 Google 帳號。

第二台第一次使用時：

```text
設定
→ 連接 Google
→ 從雲端還原
```

之後每次操作，如果開啟「操作後自動同步 Excel＋JSON」，程式會在短暫延遲後同步。

同步流程：

```text
下載最新雲端 JSON
↓
依每筆資料 updatedAt 合併
↓
存回手機 IndexedDB
↓
重新產生 Excel
↓
更新 Google Drive Excel＋JSON
```

這樣比單純「最後一台手機整包覆蓋」更不容易互相蓋掉資料。

但仍建議不要兩個人同一秒修改同一位團員的同一筆資料。

---

# 預設羽球設定

```text
一季：12 週
每次：2 桶球
每桶：$700
本次球費：$1,400
固定每人扣款：$350
固定團員：4 位
```

可在設定頁隨時修改。

---

# 第一次建議操作順序

1. 設定 Google Client ID
2. 連接 Google
3. 到「團員」把固定1～固定4改成實際姓名
4. 每位按「儲值」→ $4,200
5. 到設定記錄目前球桶庫存
6. 打球當天按「開始今日球局」
7. 誰有來就直接點他的卡片
8. 打完按「完成本日球局」
9. Google Drive 會自動更新 Excel＋JSON

---

# 出席扣款邏輯

## 固定扣款模式

預設：

```text
來一次 = -$350
```

例如：

```text
季初儲值 $4,200
第 1 次出席 → $3,850
第 2 次出席 → $3,500
第 3 次出席 → $3,150
```

取消出席後，該次 charge 交易會標記作廢，餘額會自動恢復。

## 平均分攤模式

例如：

```text
本次球費 $1,400
3 人出席
```

系統會用整數分攤：

```text
$467
$467
$466
```

總和仍然是 $1,400。

---

# 手機安裝

## iPhone

Safari 打開 GitHub Pages：

```text
分享
→ 加入主畫面
```

## Android

Chrome 打開 GitHub Pages：

```text
選單
→ 安裝應用程式 / 加到主畫面
```

---

# 發布新版本時

如果你修改 JS / CSS，但手機還看到舊畫面，請修改：

```js
const CACHE_VERSION='badminton-drive-excel-v1-0-0';
```

例如改成：

```js
const CACHE_VERSION='badminton-drive-excel-v1-0-1';
```

再上傳 GitHub。

---

# 專案結構

```text
/
├─ index.html
├─ manifest.webmanifest
├─ sw.js
├─ README.md
├─ icons/
│  ├─ icon-192.png
│  └─ icon-512.png
├─ css/
│  └─ style.css
└─ js/
   ├─ core.js       # IndexedDB、團員、球局、扣款
   ├─ reports.js    # 產生 Excel / JSON
   ├─ google.js     # Google 登入與 Drive API
   └─ app.js        # 畫面與操作
```

---

# 安全說明

程式使用：

```text
https://www.googleapis.com/auth/drive.file
```

App 只要求它透過 Google Drive API 建立 / 使用的檔案存取權限，而不是把你的 Google 密碼放進程式。

OAuth Client ID 本身可以放在前端；不要把 Google Client Secret 放進 GitHub。這套純前端 PWA 不需要 Client Secret。

Google access token 只放在目前頁面的記憶體，不寫進 IndexedDB。重新開啟 App 時會嘗試無提示重新取得授權；如果 Google 或瀏覽器要求互動，就在同步時重新按一次 Google 授權即可。
