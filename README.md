# 麻雀神器 PRO — AI 拍照識別、付費會員、廣告收益

`comparetiger.com/mahjong.html` 入面 embed 嘅 Capacitor + React app。
AI 自動識別麻雀牌面、本地計番、Google Play 訂閱、AdMob banner。

## 架構 (Phase 1)

```
┌────────────────────────────────────────────────────────────────────┐
│                       Capacitor 6 (Android / iOS / PWA)            │
│                                                                    │
│  ┌──────────────────── React UI ───────────────────────────────┐   │
│  │  App.tsx  ─ useEntitlements()                              │   │
│  │    ├── <AdBanner>          (server entitlement gates mount)│   │
│  │    ├── <PremiumGate>       (free → upgrade CTA)            │   │
│  │    ├── <AiCameraPanel>     (Phase 1: image picker + upload)│   │
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

**Phase 1** 暫時冇 production backend —— `server/mock-server.mjs` 充當 stub。
**Phase 2** 會以 Node/Express + Firestore + Google Play Developer API 取代。
**Phase 3** 會接入 Capacitor 嘅 `@capacitor-community/in-app-purchases`
(or `@capacitor-community/google-play-billing`) 連去 real Google Play。
**Phase 4** 會接入 `@capacitor-community/admob`。

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
        │  Firebase: savetheday-2377a  │  (dev-only, Phase 2 會轉去專屬 project)
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

### 試 AI 拍照流程

1. 去 `計番` tab
2. 撳 `mode === 'camera'` (右上角圖示)
3. 應該見到 **綠色升級卡** `<PremiumGate>` 而唔係 upload 掣
4. 撳 `了解升級方案` → `<UpgradeModal>`
5. 撳 `立即升級` → mock-server 會將 entitlement 切換去 PRO，refresh
   hook 重新 fetch → AdBanner 消失，camera 變成可以 upload
6. 上傳圖片 → mock-server canned result 返 `W1..T5`，UI 顯示「不確定牌」
   inline 編輯

### Free user 嘗試直入 mock-server

```bash
curl -X POST -F "image=@/etc/hosts" \
     -F "gameMode=HK" -F "roundWind=東" -F "seatWind=東" \
     http://localhost:8787/api/vision/analyze
# → 403 {"code":"AI_PREMIUM_REQUIRED", ...}
```

呢個就係 spec §8 要求嘅：backend 真係 reject，唔係淨係 hide 掣。

### 環境變數

`.env.example` 列晒。`.env` 同 `.env.local` 唔 commit。

| Var | Phase | Default |
|---|---|---|
| `VITE_API_BASE_URL` | 1 | `http://localhost:8787` |
| `VITE_USE_MOCK_BACKEND` | 1 | `1` |
| `VITE_GOOGLE_WEB_CLIENT_ID` | 3 | (Phase 0.4 取得) |
| `VITE_ADMOB_BANNER_UNIT_ID` | 4 | (Phase 0.2 取得) |

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
| **0** | Provisioning: MiniMax account、AdMob unit、Play sub、OAuth | 🟡 In progress |
| **1** | Frontend service layer + entitlement gate + mock backend | ✅ DONE (e62d0a4) |
| **2** | Real backend (Node + Firestore + entitlement service) | ⏳ |
| **3** | Google Play Billing + restore + receipt verification | ⏳ |
| **4** | AdMob native banner + RTDN + per-placement analytics | ⏳ |
| **5** | Production hardening (auth, rate limit, crash reporting) | ⏳ |

## Phase 1 同 Gemini 時代嘅分別

**Phase 0** 嘅舊做法：每個 user 喺 `設定` tab 自己輸入 `gemini_api_key`，
前端直接 `fetch(generativelanguage.googleapis.com)`。任何 copy-paste 個 bundle
嘅人(包括你自己 website visitor)都可以偷用你嘅 key，而你自己就收 Google Cloud 賬單。

**Phase 1+ 嘅做法**：API key 改放 backend，frontend 只 call 自己嘅 backend。
backend 用 Firebase Auth、Google Play purchase token 驗證 entitlement。
Free user 嘅 request backend 一定 reject。Quota 用 server-side counter 計。
