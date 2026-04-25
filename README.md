# InventoryIQ — v8 Patent Edition

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
│   └── dashboard.html    ← desktop manager dashboard
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

## Six patent innovations — all active in this build

1. **DSE — Differential Sync Engine** — only changed records transmitted (~80% bandwidth reduction)
2. **VCR — Vector Clock Resolver** — three-phase deterministic merge for offline-first clients
3. **PAP — Predictive Analytics Pre-fetcher** — speculative computation during `requestIdleCallback`
4. **EnergyGuard** — gates pre-fetch via `navigator.getBattery()`
5. **FieldLock + CLOCK_OFFSET** — NTP-style clock sync with sub-field-level mutex
6. **SHA-256 Integrity Hash** — Web Crypto API with FNV-1a fallback + auto-rollback

See `docs/index.html` "More → Patent Status" or the patent docx in your records for the full 16-claim filing.

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

```sql
create table if not exists inventory_v8 (
  device_id   text primary key,
  data        jsonb not null,
  sales_log   jsonb,
  updated_at  timestamptz default now()
);
alter table inventory_v8 enable row level security;
create policy "anon read"   on inventory_v8 for select using (true);
create policy "anon write"  on inventory_v8 for insert with check (true);
create policy "anon update" on inventory_v8 for update using (true) with check (true);
```

3. Paste your project URL and anon key into `mobile/src/lib/supabase.js` (and the matching `<script>` block at the top of `docs/index.html` and `docs/dashboard.html` if you want web sync too)

4. Rebuild — sync now works across devices via Device ID.

If the keys are left empty, **the app still works** — Sync to Cloud silently saves a local snapshot you can roll back to. No errors, no dialogs.

---

## License

Proprietary. Patent application v4.0 filed at the Indian Patent Office, Chennai branch. All rights reserved.
