# InventoryIQ v4 — Full-Stack MBA Project (PRD)

## Problem Statement (verbatim)
Fix the stack overflow error in `InventoryIQ_v4.html`, then add a FastAPI + MongoDB backend and a React Native mobile app. Single-user MVP, no auth, localStorage-first with optional backend sync.

## Architecture Overview
```
┌──────────────────────────────┐        ┌──────────────────────────┐
│  InventoryIQ_v4.html         │        │  React Native Mobile App │
│  (standalone web, fixed)     │        │  (Expo, /app/mobile)     │
│  localStorage-first          │        │  AsyncStorage-first      │
└──────────────┬───────────────┘        └────────────┬─────────────┘
               │ optional sync                        │
               └──────────┬──────────────┬────────────┘
                          │              │
                 ┌────────▼──────────────▼─────────┐
                 │   FastAPI + MongoDB Backend     │
                 │   /app/backend/server.py        │
                 │   /api/{calculate, forecast,    │
                 │         sync/skus, sales, abc}  │
                 └─────────────────────────────────┘
```

## What's Implemented (Apr 2026)

### 1. Web app bug fix — `/app/workdir/InventoryIQ_v4.html` & `/app/frontend/public/InventoryIQ_v4.html`
- **Root cause**: `var origSaveToStorage = saveToStorage` at line 1898 captured the *hoisted* v4 `function saveToStorage()` (line 1899) instead of the v3 original. This made `origSaveToStorage()` call itself → infinite recursion → `Maximum call stack size exceeded`.
- **Fix**: Converted the v4 `saveToStorage` from a hoisted function declaration to a runtime assignment (`saveToStorage = function() {…}`) so the `_v3SaveToStorage` variable captures the real v3 function.
- **Verification**: Called `saveToStorage()` 100 times in browser → no overflow. All 9 navigation tabs exercised → zero page errors.

### 2. FastAPI + MongoDB backend — `/app/backend/server.py`
| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Ping mongo, return status |
| `POST /api/calculate` | Server-side EOQ/ROP/SS calculator (parity with client) |
| `POST /api/forecast` | 7-day MA + linear-trend forecast with 90% CI |
| `POST /api/sync/skus` / `GET /api/sync/skus?client_id=…` / `DELETE` | Cloud backup/restore per device |
| `POST /api/sales` / `GET /api/sales?client_id=…` | Daily sales log with auto-append to SKU history |
| `GET /api/abc/{client_id}` | Server-side ABC classification with cumulative % |
| `POST /api/import` | Bulk SKU import |

- All endpoints tested via curl: calculate, forecast, sync, sales, abc ✅
- Uses `client_id` (device UUID) as the partition key — no auth needed for MVP

### 3. React Native mobile app — `/app/mobile/`
```
mobile/
├── App.js                  (bottom-tab nav, dark theme)
├── app.json                (Expo config, backend URL)
├── package.json            (Expo 50, RN 0.73, chart-kit, async-storage)
└── src/
    ├── lib/
    │   ├── api.js          (FastAPI client)
    │   └── storage.js      (AsyncStorage + full EOQ/ROP/SS/ABC math)
    └── screens/
        ├── DashboardScreen.js   (KPIs, alert cards, full SKU list)
        ├── SKUListScreen.js     (tap-to-edit stock, per-SKU metrics)
        ├── SalesEntryScreen.js  (daily entry → local + backend sync)
        ├── ForecastScreen.js    (server-side 14-day AI forecast with CI)
        └── MoreScreen.js        (backend health, cloud backup/restore, reset)
```
- 5 screens, bottom-tab nav, dark theme matched to web app
- `dependencies` installed via yarn (34s). Run with `npx expo start` + Expo Go QR scan
- Offline-first: inventory math runs entirely on-device. Backend is optional.

## User Personas
1. **MBA student / viva defender** — demos all 7 OM concepts with a working app on phone + web + backend
2. **Small retailer** — enters daily sales on phone, gets ROP alerts, reviews forecast
3. **Project reviewer** — evaluates both architecture (3-tier) and business impact (₹79K/year savings projected)

## Core Requirements (static)
- Standalone HTML must work offline (localStorage only) ✅
- Backend must be optional — app degrades gracefully to local-only ✅
- All inventory math (SS, ROP, EOQ, ABC) has server/client parity ✅
- Single-user MVP: no auth, device UUID segments data ✅

## Backlog / Next Actions (P0 → P2)

**P0 — next session**
- Port the 9-feature linear-regression ML model (gradient descent) from the web app into `mobile/src/lib/ml.js` so mobile matches web's auto-retraining capability.
- Add a Simulation tab to mobile (30/90-day stochastic simulation with shock probability).

**P1**
- Push notifications via `expo-notifications` when any SKU crosses ROP
- Offline sales queue: buffer entries when backend is down, flush on reconnect
- ABC pie chart on mobile Dashboard using `react-native-chart-kit`
- Web app: allow pointing to the new `/api/*` endpoints for cloud backup (currently localStorage-only)

**P2**
- EAS Build pipeline for signed APK/IPA
- Bar-code scanner for fast stock updates on mobile
- CSV export endpoint for year-end reporting

## Files Added/Modified
| File | Status |
|---|---|
| `/app/workdir/InventoryIQ_v4.html` | Modified (stack overflow fix) |
| `/app/frontend/public/InventoryIQ_v4.html` | Copied (served via preview URL) |
| `/app/backend/server.py` | Rewrote with 8 new endpoints |
| `/app/mobile/*` | New — full Expo app (App.js, 5 screens, 2 lib files, package.json, app.json, README) |
| `/app/memory/PRD.md` | New — this file |

## How to Run
| Target | Command |
|---|---|
| Web (fixed HTML) | Open `https://inventory-ai-51.preview.emergentagent.com/InventoryIQ_v4.html` |
| Backend | Auto-runs via supervisor (port 8001, `/api/*`) |
| Mobile dev | `cd /app/mobile && npx expo start` → scan QR with Expo Go |
