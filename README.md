# InventoryIQ v4.0 — Data-Driven Inventory Control System

A full-stack MBA project implementing EOQ, Reorder Point, Safety Stock, ABC analysis, auto-learning ML forecasting, and supplier risk modelling for small-retail inventory optimization.

> **Projected business impact:** ~₹79,000 annual savings for a 12-SKU kirana store, derived from holding-cost reduction + stockout recovery via supplier-adjusted safety stock.

---

## What's in this repository

```
.
├── workdir/
│   └── InventoryIQ_v4.html     # Standalone web app (offline-first, localStorage)
├── backend/                    # FastAPI + MongoDB REST API (optional cloud sync)
├── frontend/                   # React shell that redirects to the standalone HTML
├── mobile/                     # React Native + Expo mobile companion
└── memory/PRD.md               # Product requirements & architecture doc
```

### Three deliverables, one codebase

| Piece | Tech | What it does |
|---|---|---|
| **Standalone web app** | Single HTML + vanilla JS + Chart.js | 12-module inventory dashboard — works 100% offline, data in `localStorage` |
| **Backend API** | FastAPI + MongoDB + Motor | Optional cloud sync, server-side ML forecast, ABC analysis, sales log |
| **Mobile app** | React Native + Expo 50 | 5-screen companion — dashboard, SKUs, daily sales entry, AI forecast, settings |

---

## Host the project on GitHub + public URLs

### Step 1 — Push to GitHub

Click the **"Save to GitHub"** button in the Emergent chat input. This will:
- Ask you to authorize Emergent with your GitHub account (one-time).
- Create a new repository (or push to an existing one) with the entire `/app` folder.
- Set up the remote and push automatically — no git commands needed.

### Step 2 — Host each piece (all free)

#### 🌐 Standalone web app → GitHub Pages

1. Open your repo on GitHub → **Settings → Pages**.
2. **Source:** `Deploy from a branch` · **Branch:** `main` · **Folder:** `/` (root) → **Save**.
3. Wait 1–2 minutes. Your app will be live at:
   ```
   https://<your-username>.github.io/<repo-name>/workdir/InventoryIQ_v4.html
   ```

That's it — the HTML file is fully self-contained (Chart.js CDN is the only external dependency), so Pages is the zero-config choice.

Alternative: drag the `workdir/InventoryIQ_v4.html` file onto [netlify.com/drop](https://app.netlify.com/drop) — instant public URL, no account required.

#### ⚙️ FastAPI backend → Render.com (free tier)

1. Sign up at [render.com](https://render.com) and connect your GitHub account.
2. Click **New → Web Service** → pick your repo.
3. Configure:
   - **Root directory:** `backend`
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn server:app --host 0.0.0.0 --port $PORT`
4. Add environment variables:
   - `MONGO_URL` → get a free MongoDB Atlas cluster at [cloud.mongodb.com](https://cloud.mongodb.com), copy the connection string
   - `DB_NAME` → `inventoryiq`
   - `CORS_ORIGINS` → `*` (or your GitHub Pages URL for lockdown)
5. Click **Create Web Service**. Live in ~3 minutes at `https://<your-service>.onrender.com`.

#### 📱 Mobile app → Expo EAS Build

No app store needed — install Expo CLI locally, then:
```bash
cd mobile
npx expo install
npx eas build --platform android   # produces an installable .apk
```
Share the resulting download link with anyone — they install it directly on their Android phone.

---

## Running locally (development)

```bash
# Backend (FastAPI on port 8001)
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8001

# Frontend shell + standalone HTML (served together on port 3000)
cd frontend
yarn install
yarn start

# Mobile (Expo dev server — scan the QR with the Expo Go app)
cd mobile
yarn install
npx expo start
```

Then open:
- `http://localhost:3000` → auto-redirects to InventoryIQ dashboard
- `http://localhost:8001/api/health` → backend health check

---

## Core features (v4)

- **Real-time dashboard** — 12 SKU alerts with ROP breach detection
- **Auto-calculations** — EOQ, Safety Stock (with lead-time variability), Reorder Point, ABC classification
- **90-day simulation** — Seasonal / trending / stable demand patterns + shock probability
- **AI forecasting** — Server-side 14-day projection with 90% confidence intervals
- **Auto-learning ML** — Gradient-descent linear regression retrains every 7 new data points
- **Feedback loop** — Safety stock and EOQ multipliers adjust based on observed outcomes
- **Supplier risk modelling** — 4-supplier radar chart, delay-adjusted safety stock
- **ABC-segmented service levels** — Class A=99%, B=95%, C=90%
- **Financial impact report** — Monthly/annual savings breakdown, per-SKU benefit table
- **CSV import/export** — 14-column format with drag-and-drop preview
- **Offline-first** — Full functionality without internet; optional cloud backup

---

## Backend API reference

Base URL (local): `http://localhost:8001/api`

| Method | Endpoint | Body / Params | Purpose |
|---|---|---|---|
| `GET`  | `/health` | — | Mongo connection check |
| `POST` | `/calculate` | `{demand, stddev, leadtime, ltstddev, cost, ordercost, service_level, moq}` | Compute EOQ / ROP / SS |
| `POST` | `/forecast` | `{history[], days}` | 7-day MA + linear trend + 90% CI |
| `POST` | `/sync/skus` | `{client_id, skus[]}` | Push local data to cloud |
| `GET`  | `/sync/skus?client_id=…` | — | Restore from cloud |
| `POST` | `/sales` | `{client_id, sku_id, units_sold}` | Log a daily sale |
| `GET`  | `/abc/{client_id}` | — | Server-side ABC classification |
| `POST` | `/import` | `{client_id, rows[]}` | Bulk SKU import |

Authentication: none (single-user MVP). Data is partitioned by a `client_id` (device UUID auto-generated on first launch).

---

## License

MIT — free for academic and commercial use.
