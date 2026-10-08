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
│       │   ├── supabase.js  ← cloud sync (works offline too)
│       │   └── theme.js     ← shared design tokens
│       └── screens/
│           ├── HomeScreen.js
│           ├── SalesScreen.js
│           ├── ProductsScreen.js
│           ├── ForecastScreen.js
│           └── MoreScreen.js
├── proxy/                ← Cloudflare Worker that holds the Groq key for the AI Advisor
├── supabase/schema.sql   ← cloud sync schema (run once in Supabase)
├── tests/check.mjs       ← self-check: node tests/check.mjs
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
- **Cloud sync** (optional) — full snapshot push/pull through Supabase, keyed by Device ID.
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

The app works fully offline. To enable cross-device sync:

1. Create a free Supabase project at supabase.com
2. Run this SQL once:

Open `supabase/schema.sql`, paste it into Supabase → SQL Editor, and run it.

3. Paste your project URL and anon/publishable key into `IQ_CLOUD` in `docs/iq-core.js` (web) and `mobile/src/lib/supabase.js` (APK)

4. Rebuild — sync now works across devices via Device ID.

If the keys are left empty, **the app still works** — Sync to Cloud saves a snapshot on this device and says so.

**Security:** the schema gives the anon key no direct table access; data is only reachable through
`iq_push` / `iq_pull` with an exact Device ID. The Device ID is effectively the store's password —
don't post it publicly. (Earlier versions of this README created policies that let anyone list every
store's data; re-running `schema.sql` removes them.)

## Checks

```bash
node tests/check.mjs
```

---

## License

Proprietary. Patent application v4.0 filed at the Indian Patent Office, Chennai branch. All rights reserved.
