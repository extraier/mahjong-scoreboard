# Play Store Listing — 麻雀神器 PRO

Copy-paste text for the Google Play Console listing.
Package: `com.comparetiger.mahjongscoreboard` · Version: 1.0 (versionCode 1)

---

## App name (30 char limit)

```
麻雀神器 PRO
```

---

## Short description (80 char limit)

```
AI 拍牌識別，自動計分。廣東麻雀上桌即刻開枱。
```

---

## ⚠️ Facts verified before publishing — read this

Checked against the actual source on 2026-10-24:

| Claim | Reality | Declare in Console |
|---|---|---|
| AdMob ads | **Not live.** `AdBanner.tsx` renders a static "廣告位置 / Phase 1" placeholder. The `@capacitor-community/admob` plugin is not installed. | "Contains ads" = **No** (for this build) |
| In-app purchases | **Not live.** `billingClient.ts` is a Phase 3 stub — every call resolves `{ok: false, error: '付款功能在 Phase 1 階段尚未啟用'}`. No Play Billing plugin installed. | "In-app purchases" = **No** (for this build) |
| Data collection | Vision AI runs on the **local Mac** (not on-device on the phone — see the caveat below) and the server writes a `vision_calls` Firestore doc keyed by `requestId`. Auth is Firebase. | "Collects user data" = **Yes** (see Data safety below) |
| AI on-device? | **No.** The APK talks to the local/Vercel vision API. The claim "AI 識別喺本機處理" in the full description is **not true for the shipped APK**. | Do not claim on-device processing |

**Two things to fix before you publish:**

1. The privacy policy URL below **404s** — `https://comparetiger.com/mahjong-privacy`
   does not exist, and `https://comparetiger.com/privacy-policy` returns 502.
   Play Console **requires** a working privacy policy URL for a live app.
2. The "私隱" section of the full description overclaims. Either reword it
   (see the corrected version below) or wire up the real privacy page first.

### Corrected 私隱 section for the full description

```
◆ 私隱
你嘅牌相會用嚟做 AI 識別，識別完之後喺伺服器記錄一次
（你嘅使用時間、識別結果、機型型號），用嚟統計同除錯。
唔會公開你嘅相片，亦唔會攞嚟賣廣告。
想刪資料可以喺 App 內 或者 電郵我哋。
```

---

## Full description (4000 char limit)

```
麻雀神器 PRO — 廣東麻雀計分必備 App

打牌唔使再數隻，影相就得。麻雀神器 PRO 用 AI 直接睇牌、認牌、計分，
一枱開工，埋單準又快。

◆ AI 拍牌識別
影低四隻牌，AI 即刻認晒出嚟，冇牌冇得漏。支援萬、筒、條、
東南西北中發白，冇字冇錯。

◆ 自動計分
捉完隻牌就自動計番，番數、底分、庄家位、買馬、起莊一齊計埋。
唔使再靠個腦算，唔使再爭「呢隻到底幾多番」。

◆ 起手・跟牌記錄
每隻牌幾時出、邊隻打、邊家食，每一隻都記得清清楚楚。
回睇返上枱，成局過程一目了然。

◆ 對局統計
打咗幾多枱、勝率幾多、平均番數幾多，越打越知自己。
數據留住，唔會一 close 就冇。

◆ 界面
全繁體中文，廣東話用字，唔使適應。
字大啲，牌大啲，枱面光線暗都睇得清。

---

適合：
• 雀友聚會，唔想手抄
• 熟客，想知自己進步咗幾多
• 唔熟悉規則，想有個自動計分幫手
• 任何想快啲開枱、快啲埋單嘅人

免費下載，PRO 版本解鎖 AI 識別同進階統計。

免責聲明：本 App 只作計分輔助，雀枱爭議請以實體牌局為準。
```

---

## Category / contact

| Field | Value |
|---|---|
| App type | App |
| Category | Games → Casual |
| Content rating |  Everyone (no violence, no user-generated content, no ads) |
| Contact email | `roger-lau@outlook.com` |
| Website | `https://comparetiger.com/mahjong.html` |
| Privacy policy URL | `https://comparetiger.com/mahjong-privacy` |

---

## Data safety answers

| Question | Answer |
|---|---|
| Does your app collect or share user data? | **Yes** — user account (Firebase Auth: email/Google), photos sent for AI recognition, and app activity logs (`vision_calls`) |
| Types | Personal info (email), Photos & videos (game photos), App activity (usage logs) |
| Is data encrypted in transit? | **Yes** — HTTPS |
| Can users request data deletion? | **Yes** — contact email, or a deletion endpoint (see `google-play-data-deletion` skill) |
| Does the app share data with third parties? | **No** |
| Is data collection optional? | **Yes** — photo recognition can be declined; account is required for saving scores |

> Note: the vision server currently runs on the **local Mac** for development.
> Before public release, move it to a hosted endpoint (the Vercel
> `mahjong-scoreboard.vercel.app` frontend is live; the vision API is not).
> Play review testers need a **working** backend — if the API only answers
> on your LAN, the app will appear broken to reviewers.

---

## Store assets (ready in `dist/`)

| Asset | File | Size |
|---|---|---:|
| App icon 512×512 | `play-store-icon-512.png` | 267 KB |
| Feature graphic 1024×500 | `play-store-feature-graphic-1024x500.png` | 160 KB |
| Phone screenshot 1 | `play-store-screenshot-phone-1.png` | 1.56 MB |
| Phone screenshot 2 | `play-store-screenshot-phone-2.png` | 1.57 MB |
| Release bundle | `mahjong-pro-release-v1.0.aab` | 4.22 MB |

> Feature graphic is centre-weighted (medallion + text centred as a block).
> Play crops it differently per placement — if the mobile crop clips the
> slogan, regenerate a mobile-safe variant.

---

## Upload

Once the app exists in Play Console and the service account
`hermes@foodswipe-fe76a.iam.gserviceaccount.com` has **Release Manager**:

```bash
cd ~/mahjong-scoreboard
python3 scripts/play-upload-aab.py
```

Binds to the **Internal testing** track, then commit the Play edit.

---

## Pre-submit checklist

- [ ] App created in Play Console with package `com.comparetiger.mahjongscoreboard`
- [ ] Service account invited as Release Manager
- [ ] Store listing: name, short + full description, icon, feature graphic, ≥2 screenshots
- [ ] App content: privacy policy URL reachable, no ads declared, target audience
- [ ] Content rating questionnaire complete → IARC rating shown
- [ ] Data safety: "no data collected" + "no data shared"
- [ ] App access: all functionality available without special access
- [ ] Countries & pricing: Free, select distribution countries
- [ ] Play App Signing enabled (Google-managed key, our keystore as upload key)
- [ ] Internal testing track has ≥1 tester added
