# 麻雀神器 — AI 拍照識別、付費會員、廣告收益

`comparetiger.com/mahjong.html` 入面 embed 嘅 Capacitor + React app。
AI 自動識別麻雀牌面、本地計番、Google Play 一次過終身會員（HK$38）、免費每日 3 次相機識別，用完可以自願睇獎勵短片。計分表冇橫額廣告。

## 架構 (Phase 1)

```
┌────────────────────────────────────────────────────────────────────┐
│                       Capacitor 6 (Android / iOS / PWA)            │
│                                                                    │
│  ┌──────────────────── React UI ───────────────────────────────┐   │
│  │  App.tsx  ─ useEntitlements()                              │   │
│  │    ├── <VisionAccessSheet> (out of scans: ad / HK$38 / hand)│   │
│  │    ├── <AiCameraPanel>     (camera; no ad while it is open)│   │
│  │    ├── <SubscriptionPanel> (Phase 1: read-only stub)        │   │
│  │    └── <UpgradeModal>      (Phase 1: dev premium-on stub)  │   │
│  └──────────────────────────┬─────────────────────────────────┘   │
│                              │                                     │
│  ┌───────────── Service layer ─────────────┐                      │
│  │  apiClient / entitlementClient /         │                      │
│  │  visionClient / billingClient            │                      │
│  └──────────────────┬──────────────────────┘                      │
└─────────────────────┼──────────────────────────────────────────────┘
                      │ Bearer <auth-token>
                      ▼
        ┌──────────────────────────────────────┐
        │   /api/me/entitlements               │
        │   /api/vision/analyze                │    Production: Vercel
        │   /api/billing/...                   │    (Phase 2 deploy)
        │   /api/dev/premium-on/off (Phase 1)  │
        └──────────────────────────────────────┘
```

**Phase 1** 嘅 `server/mock-server.mjs` 仍然可以本地試 UI。Production API 係 Node/Express（Vercel）+ Firestore。
**Billing** 已經係一次過商品 `premium_lifetime`（Play 購買選項 `mahjongpremium`，HK$38），用 `capacitor-plugin-cdv-purchase`。冇訂閱。
**廣告** 只得獎勵短片（`@capacitor-community/admob`），喺免費用戶當日識別次數用完、並且自己撳「睇廣告」先至播放。計分表唔放 banner。

## Backend & Data Pipeline (Phase 1 dev)

Phase 1 嘅 real backend 跑喺你部 Mac，**唔會 deploy 上 Vercel**。
Vercel 部署只係 serve `dist/` (frontend bundle)，冇 Node API server。
Capacitor Android app (production target) 透過 local network 訪問你部 Mac 嘅 Node server。

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Your Mac (dev)                                                            │
│                                                                            │
│   ┌──────── Node server :8788 ──────┐    ┌── FastAPI :8789 ──┐            │
│   │  /api/me/entitlements           │    │  /analyze_json    │            │
│   │  /api/vision/analyze  ──────────┼───▶│  (ViT v5+ensemble)│            │
│   │  /api/vision/correct            │    │                   │            │
│   │   └─▶ writes vision_calls       │    └───────────────────┘            │
│   │   └─▶ writes vision_corrections │                                     │
│   └──────────────┬──────────────────┘                                     │
│                  │                                                        │
└──────────────────┼────────────────────────────────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────────────┐
        │  Firebase: mahjong-sc-2377a  │  (production project; older notes said savetheday-2377a)
        │  /vision_calls              │
        │  /vision_corrections        │
        └──────────────────────────────┘
```

### Run the full stack

```bash
# Tab 1: vision server (Python)
cd ~/mahjong-scoreboard/server
LOCAL_VISION_MODEL_DIR=../models/mahjong-vision-finetuned-v5 \
LOCAL_VISION_DETECTOR=ensemble \
.mlvenv/bin/python scripts/local_vision_server.py --port 8789

# Tab 2: Node API server
cd ~/mahjong-scoreboard/server
AUTH_MODE=test \
FREE_PREMIUM_TESTING_UIDS=test-user,admin \
FIREBASE_PROJECT_ID=savetheday-2377a \
FIREBASE_SERVICE_ACCOUNT_JSON=$(base64 -i ~/.hermes/secrets/savetheday-firebase-sa.json | tr -d '\n') \
LOG_LEVEL=info \
node --import file://$(pwd)/node_modules/tsx/dist/loader.mjs src/index.ts
```

### Smoke test (one-liner)

`scripts/smoke.sh` 會 check 5 個 endpoints 並 print PASS/FAIL：

```bash
./scripts/smoke.sh
# 5 passed, 0 failed
```

CI 用得著 (verify deploy 後冇 break)，亦方便 "我啱啱係咪整爛咗個 dev stack"。

### 數據流向

每次 `/api/vision/analyze` 成功：
1. AI 識別 → `vision_calls` doc (`uid`, `image_hash`, `predicted_tiles`, `confidence`, `provider`)
2. 用戶撳「識別有誤」→ `/api/vision/correct` → lookup 返 `vision_calls` → 計 diff → `vision_corrections` doc (`predicted_tiles`, `corrected_tiles`, `wrong_tiles`, `photo_consent`, 同 `image_hash`)

兩個 collection 透過 `image_hash` 連埋。Phase 2 嘅 model retrain 會用呢啲數據做 ground truth。

## Quick start (Phase 1 dev)

```bash
npm install

# Tab 1: 啟 mock-server
npm run dev:mock

# Tab 2: 啟 Vite dev server
npm run dev
```

打開 http://localhost:5173 ，預設係 **免費 user**。

### 試 AI 拍照同每日次數（mock）

免費用戶一開始有 **3 次成功識別**。手動選牌冇限制。Mock 將每一次 analyze POST 當成功（真正伺服器先會喺識別失敗時退還次數）。

1. 去 `計番` tab，撳 `AI 拍照`
2. 仲有次數：直接見到相機。用完 3 次之後再撳，先見到三個選擇：睇短片加 5 次、HK$38 解鎖、手動入牌
3. 喺 mock（`VITE_USE_MOCK_BACKEND=1`）撳「睇短片」唔會播片，會直接叫 `POST /api/ads/reward/dev-claim` 加 5 次，然後返去相機
4. 終身（`POST /api/dev/premium-on`）係無限次數，而且唔會再見到廣告選擇

```bash
# 用完 3 次之後
curl -X POST -F "image=@/etc/hosts" \
     -F "gameMode=HK" -F "roundWind=東" -F "seatWind=東" \
     http://localhost:8787/api/vision/analyze
# → 429 {"code":"QUOTA_EXCEEDED", ...}
```

次數係伺服器計。客戶端藏唔到掣都唔可以無限 call。

### 環境變數

`.env.example` 列晒。`.env` 同 `.env.local` 唔 commit。

| Var | Phase | Default |
|---|---|---|
| `VITE_API_BASE_URL` | 1 | `http://localhost:8787` |
| `VITE_USE_MOCK_BACKEND` | 1 | `1` |
| `VITE_GOOGLE_WEB_CLIENT_ID` | 3 | (Phase 0.4 取得) |
| `VITE_ADMOB_REWARDED_UNIT_ID` | 獎勵短片 | 留空 = Google 官方測試單元 `ca-app-pub-3940256099942544/5224354917`。正式單元先至填，唔好硬寫一個真 ID |

## 獎勵短片點試

每日次數喺 **香港時間 00:00** 重置（`Asia/Hong_Kong`，UTC+8，冇夏令時間）。一次「用」= 一次成功嘅 `POST /api/vision/analyze`。開相機、相唔合格、模型失敗、重拍都唔扣。

Android 測試單元（`VITE_ADMOB_REWARDED_UNIT_ID` 留空就係呢個）同 `android/app/src/main/res/values/strings.xml` 入面嘅 sample app id `ca-app-pub-3940256099942544~3347511713` 都係 Google 公開嘅測試 ID，唔係正式廣告。

測試廣告 **唔會** 打 AdMob server-side verification。想喺自己部機睇完測試片之後次數真係加到，喺非 production 嘅 API 設 `ADMOB_REWARD_DEV_MODE=1`（`NODE_ENV=production` 會忽略呢個旗）。App 睇完片會先試 `POST /api/ads/reward/dev-claim`，production 回 404，然後先至 poll 等 SSV 入賬。客戶端自己講「我睇完」喺 production 加唔到次數。

正式上架之前 Roger 要做（呢個 PR 唔改 Play Console，亦唔加 versionCode）：

1. AdMob 帳戶、App、一條獎勵廣告單元
2. 將單元 ID 放入 `VITE_ADMOB_REWARDED_UNIT_ID`，並將 `strings.xml` 嘅 `admob_app_id` 換成正式 App ID（測試 App ID 配正式單元係播唔到錢）
3. AdMob 控制台設定 SSV callback：`https://mahjong-scoreboard-nine.vercel.app/api/ads/admob-ssv`（用 Google 公開 key 驗簽，唔使額外 secret）
4. Play Console：Ads 宣告改 Yes、Data safety 加上廣告 ID、將 `docs/mahjong-privacy.html` 刊登到而家個私隱政策網址
5. 之後先至出 closed-test build

## Build / deploy

```bash
npm run build      # tsc + vite build → dist/
npm run preview    # 試 production bundle

# Capacitor Android sync
npx cap sync android
npx cap open android   # 用 Android Studio build .aab
```

Live deploy：Vercel auto-deploy on `git push origin main`。
Production URL：https://mahjong-scoreboard-nine.vercel.app

## Phase 路線圖

| Phase | 範圍 | Status |
|---|---|---|
| **0** | Provisioning: vision provider、OAuth、AdMob account | 🟡 AdMob 帳戶同正式獎勵單元未有 |
| **1** | Frontend service layer + entitlement gate + mock backend | ✅ |
| **2** | Real backend (Node + Firestore + entitlement service) | ✅ |
| **3** | Google Play Billing（一次過 `premium_lifetime`）+ restore | ✅ 已測買同還原。冇訂閱 |
| **4** | 獎勵短片（每日 3 次識別，睇廣告 +5，每日最多 3 次廣告）。冇計分表 banner | ✅ 代碼；正式單元同 SSV callback 未設定 |
| **5** | Production hardening (auth, rate limit, crash reporting) | ⏳ |

## Phase 1 同 Gemini 時代嘅分別

**Phase 0** 嘅舊做法：每個 user 喺 `設定` tab 自己輸入 `gemini_api_key`，
前端直接 `fetch(generativelanguage.googleapis.com)`。任何 copy-paste 個 bundle
嘅人(包括你自己 website visitor)都可以偷用你嘅 key，而你自己就收 Google Cloud 賬單。

**Phase 1+ 嘅做法**：API key 改放 backend，frontend 只 call 自己嘅 backend。
backend 用 Firebase Auth、Google Play purchase token 驗證 entitlement。
免費用戶每日 3 次成功識別（香港時間零點重置）；終身會員無限，而且唔會見到廣告。Quota 用 server-side counter 計。
