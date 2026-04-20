# InventoryIQ Mobile (React Native + Expo)

Mobile companion to the InventoryIQ web app (v4.0). Full EOQ / ROP / Safety Stock / ABC engine on-device, with optional cloud sync to the FastAPI backend.

## What's in here

```
mobile/
├── App.js                        ← Root + bottom-tab navigation
├── app.json                      ← Expo config (backend URL lives here)
├── package.json                  ← RN 0.73 + Expo 50 + chart-kit + async-storage
├── babel.config.js
└── src/
    ├── lib/
    │   ├── api.js                ← FastAPI client (calculate / forecast / sync / sales / abc)
    │   └── storage.js            ← AsyncStorage + full inventory math (SS, ROP, EOQ, ABC)
    └── screens/
        ├── DashboardScreen.js    ← KPIs + alert cards + all-SKU list
        ├── SKUListScreen.js      ← Tap-to-edit stock, per-SKU metrics
        ├── SalesEntryScreen.js   ← Daily sales entry → local history + backend push
        ├── ForecastScreen.js     ← Server-side 14-day forecast with 90% CI
        └── MoreScreen.js         ← Backend health, cloud backup, reset
```

## Architecture — the same model as the web app

| Layer | What it does |
|---|---|
| `AsyncStorage` | Local-first persistence (identical semantics to the web `localStorage`) |
| `src/lib/storage.js` | All inventory math runs on-device → works 100% offline |
| `src/lib/api.js` | Optional cloud sync to `/api/*` endpoints (FastAPI + MongoDB) |
| `client_id` | Auto-generated device UUID stored on first launch — no login needed |

## Backend (already live)

Base URL: `https://inventory-ai-51.preview.emergentagent.com`

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Check Mongo connection |
| `POST /api/calculate` | EOQ/ROP/SS for one SKU |
| `POST /api/forecast` | 7-day MA + linear trend + 90% CI |
| `POST /api/sync/skus` | Push all SKUs to cloud |
| `GET  /api/sync/skus` | Pull all SKUs for a device |
| `POST /api/sales` | Record a daily sales entry |
| `GET  /api/abc/{client_id}` | Server-side ABC classification |

## Running on a real phone (fastest path)

```bash
cd /app/mobile
npx expo start
# scan the QR code with the Expo Go app on your Android/iOS phone
```

The Expo Go app lets you run the full app **without an Apple/Google developer account**. It works over your local Wi-Fi for development, and Expo will build real APK/IPA binaries when you're ready for production (see `expo build` or EAS Build).

## Building for production

```bash
cd /app/mobile
npx eas build --platform android  # produces a signed .apk/.aab
npx eas build --platform ios      # produces a signed .ipa (needs Apple dev account)
```

## What's mocked / what's real

| Feature | Status |
|---|---|
| Local inventory math (EOQ/SS/ROP/ABC) | ✅ Real — computed on device |
| Dashboard + alerts | ✅ Real |
| Daily sales entry | ✅ Real — saves locally + pushes to backend |
| Cloud backup / restore | ✅ Real — tested end-to-end |
| AI forecast | ✅ Real — server-computed (MA + linear trend + residual CI) |
| Advanced ML (retraining, drift) | 📋 Next — port from web app's gradient-descent model |

## Known next steps

1. **Port the 9-feature linear-regression ML model** from `InventoryIQ_v4.html` → `src/lib/ml.js`
2. **ABC pie chart** on the Dashboard using react-native-chart-kit's PieChart
3. **Simulation screen** — 30/90-day discrete simulation with shock probability
4. **Push notifications** via Expo Notifications for critical stock alerts
5. **Offline queue** — buffer sales entries when backend is unreachable, flush on reconnect
