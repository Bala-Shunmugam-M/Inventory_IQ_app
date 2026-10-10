# InventoryIQ Mobile (React Native + Expo)

Native Android/iOS build of InventoryIQ. Same data model and storage keys as the
web app in `docs/`, so a store can move between web and APK via cloud sync.

## Layout

```
mobile/
├── App.js                     ← bottom-tab navigation (5 screens)
├── app.json / eas.json        ← Expo + EAS build config
└── src/
    ├── lib/
    │   ├── storage.js         ← AsyncStorage + engine: ROP, EOQ, ABC, forecast, ordering
    │   ├── cloud.js           ← optional cloud sync client for ../backend
    │   └── theme.js
    └── screens/
        ├── HomeScreen.js      ← today's actions: what to order
        ├── SalesScreen.js     ← end-of-day sales entry
        ├── ProductsScreen.js  ← add / edit / receive stock
        ├── ForecastScreen.js  ← per-product demand forecast
        └── MoreScreen.js      ← sync, backup history, demo data, reset
```

Everything runs on the device and works offline. Cloud sync is off until you
set `API_BASE` in `src/lib/cloud.js` to your deployed backend URL.

## Run

```bash
cd mobile
npm install
npx expo start      # scan the QR code with Expo Go
```

Build an APK: see `BUILD_APK.md`.
