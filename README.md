# InventoryIQ — v8.2

> Decision-assistant inventory app for kirana shops and small retailers.
> Tells you exactly what to order today, instead of showing numbers and formulas.

**Live web app:** https://bala-shunmugam-m.github.io/Inventory_IQ_app/
**Desktop dashboard:** https://bala-shunmugam-m.github.io/Inventory_IQ_app/dashboard.html
**Android APK:** built via Expo EAS — see `DEPLOY.md`

---

## What's in this repo

```
repo/
├── docs/
│   ├── index.html        ← mobile web app (GitHub Pages serves this)
│   ├── dashboard.html    ← desktop manager dashboard
│   └── iq-core.js        ← shared by both: data hygiene, forecast, ordering, cloud sync
├── mobile/               ← React Native source for Android APK
│   ├── App.js
│   ├── app.json
│   ├── eas.json
│   ├── package.json
│   ├── babel.config.js
│   └── src/
│       ├── lib/
│       │   ├── storage.js   ← engine: EOQ, ROP, ML, AsyncStorage
│       │   ├── cloud.js     ← cloud sync client (works offline too)
│       │   └── theme.js     ← shared design tokens
│       └── screens/
│           ├── HomeScreen.js
│           ├── SalesScreen.js
│           ├── ProductsScreen.js
│           ├── ForecastScreen.js
│           └── MoreScreen.js
├── backend/              ← Cloudflare Worker + D1: store sync API and the Groq-key proxy for the AI Advisor
├── tests/                ← node tests/check.mjs · node tests/sync.mjs
├── .gitignore
├── README.md
└── DEPLOY.md
```

---

## Three deployment surfaces, one engine

The same data model and storage keys are used on all three surfaces, so a user can move between them seamlessly:

| Surface | File / Tooling | Storage |
|---|---|---|
| Mobile web (PWA) | `docs/index.html` served by GitHub Pages | browser `localStorage` |
| Desktop manager dashboard | `docs/dashboard.html` served by GitHub Pages | browser `localStorage` |
| Android native APK | `mobile/` built by Expo EAS | `AsyncStorage` (mirrored keys) |

All three use the same key namespace (`inventoryiq_v8_*`), so when you sync a phone to cloud and later restore on a laptop you get the same products back.

---

## What's implemented

- **Reorder engine** — reorder point (ROP), economic order quantity (EOQ) and ABC class per product.
- **Demand forecast** — linear regression blended with a 7-day moving average over daily sales.
- **Ordering loop** — "Mark ordered" records incoming stock; tap the incoming badge (or Receive) when it arrives.
  Today's action list uses inventory position (on hand + on order), so ordered items stop nagging.
- **Cloud sync** (optional) — versioned snapshot sync through `backend/`; devices join with a store link code.
- **AI Advisor** — LLM explains the locally computed numbers; it never invents them.

The patent filing describes further mechanisms (DSE delta sync, VCR vector-clock merge,
EnergyGuard, FieldLock, SHA-256 integrity hash). **They are not implemented in this
codebase yet**; the in-app Feature Status screen lists them as planned.

---

## Quick start (local dev)

### Web (instant)
Just open `docs/index.html` in a browser. No build step.

### Mobile native
```bash
cd mobile
npm install
npx expo start
```
Press `a` for Android emulator, `i` for iOS simulator, or scan the QR code with Expo Go on a real device.

### Build APK
```bash
cd mobile
eas login
eas init
eas build --platform android --profile preview
```
The APK link arrives by email in ~10 minutes.

---

## Cloud sync (optional)

The app works fully offline. Cross-device sync uses the backend in `backend/` — one Cloudflare
Worker + D1 database that also serves the AI Advisor. Deploy it (see `backend/README.md`), then:

1. Put the Worker URL in `IQ_API` in `docs/iq-core.js` (web + dashboard) and `API_BASE` in
   `mobile/src/lib/cloud.js` (APK). It's the same URL as `AI_CFG.proxy`.
2. Tap **Sync to Cloud** once. That creates your store and shows a **store link code** (`iq1:…`) in Settings.
3. On another device: **Restore from Cloud** → paste the link code. That device now syncs the same store.

If `IQ_API` is empty, **the app still works** — Sync to Cloud saves a snapshot on this device and says so.

**How it stays safe and consistent:** each store has a random 256-bit token (only its SHA-256 is stored
server-side); the link code carries it, so treat the code like a password. Saves are versioned — if
another device saved first, the server refuses the stale save, the app merges (union by product, this
device wins on clashes, sales logs combined) and saves again, so nothing is silently overwritten.

## Checks

```bash
node tests/check.mjs        # inventory engine + data hygiene
node tests/sync.mjs         # web client ⇄ real backend, end to end (in-memory SQLite)
node backend/test/run.mjs   # backend API + AI proxy
node tests/mobile-parity.mjs # React Native engine gives the same numbers as the web
```

---

## License

Proprietary. Patent application v4.0 filed at the Indian Patent Office, Chennai branch. All rights reserved.
