# DEPLOY — Going Live

Step-by-step. Follow in order.

---

## Step 1 — Replace your repo

Extract the ZIP. Open the `repo/` folder. Copy everything into your local clone of `Bala-Shunmugam-M/Inventory_IQ_app`.

Delete the old folders that the previous v7 build left behind: `backend/`, `frontend/`, `memory/`, `test_reports/`, `tests/`, `workdir/`.

Keep only what's in this new repo: `docs/`, `mobile/`, `.gitignore`, `README.md`, `DEPLOY.md`.

---

## Step 2 — Push to GitHub

```bash
cd Inventory_IQ_app
git add .
git commit -m "v8 — web + dashboard + React Native source"
git push origin main
```

If the working tree is dirty from the v7 layout, this is fine — `git add .` picks up deletions too.

---

## Step 3 — Enable GitHub Pages

Go to: **github.com/Bala-Shunmugam-M/Inventory_IQ_app → Settings → Pages**

- Source: **Deploy from branch**
- Branch: **main**
- Folder: **/docs**
- Save

Two URLs go live in ~2 minutes:

- Mobile: `https://bala-shunmugam-m.github.io/Inventory_IQ_app/`
- Desktop: `https://bala-shunmugam-m.github.io/Inventory_IQ_app/dashboard.html`

Both are fully working, share data via `localStorage`, and have a "Open Mobile View / Open Desktop View" button to cross-link.

---

## Step 4 — Cloud sync (optional, free)

The app works fully without this. Skip if you don't need cross-device sync yet.

1. Deploy the backend with its D1 database — follow `backend/README.md` (or `DEPLOY_AI.md`).

2. Paste the Worker URL in **two places**:

   **`docs/iq-core.js`** (web + dashboard):
   ```js
   var IQ_API = 'https://inventoryiq-llm-proxy.<you>.workers.dev';
   ```

   **`mobile/src/lib/cloud.js`** (APK):
   ```js
   export const API_BASE = 'https://inventoryiq-llm-proxy.<you>.workers.dev';
   ```

3. Push again. Tap Sync to Cloud once on your main device, then use its **store link code** (Settings)
   to restore on other devices.

---

## Step 5 — Build the Android APK

Prerequisites: Node 18+, `npm install -g eas-cli`, an Expo account (free).

```bash
cd mobile
npm install
eas login
eas init             # links this folder to a new EAS project — accept defaults
eas build --platform android --profile preview
```

EAS uploads your source, builds in the cloud (~8–12 minutes), and emails a download link for the APK. Install on any Android phone via "Install unknown apps".

For Play Store distribution use `--profile production` instead — that produces a `.aab` bundle.

---

## Step 6 — Verify it works

After deployment, test the round-trip:

1. Open the web app → tap More → Load Demo Data → 12 products appear
2. Open the dashboard URL in a second tab → same 12 products appear
3. Add a product on the mobile site → refresh the dashboard → it shows up
4. Delete a product on the dashboard → refresh the mobile site → gone
5. On the APK: Settings → Restore from Cloud → paste the web app's store link code → products pull down (only with the backend configured)

If any of these fail, check the browser console — the keys to look for are `inventoryiq_v8_data` (products), `inventoryiq_v8_sales` (sales log), and `iq_device_id` (this device's stable ID).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| GitHub Pages shows 404 | Wait 2 minutes after enabling, then hard-refresh (Ctrl+F5). If the URL has a trailing repo name, that's normal. |
| `eas build` says "no project ID" | Run `eas init` first. Accept the default project name. |
| APK installs but shows blank screen | Run `npx expo doctor` in `mobile/` — usually a dependency mismatch. |
| Mobile and dashboard don't share data | They only share data **on the same device/browser** because both use that browser's `localStorage`. Cross-device sync requires the backend (Step 4). |
| "Sync to Cloud" says "Saved on this device only" | `IQ_API` / `API_BASE` not set — this is the offline fallback, not an error. |
| APK build fails on first run | Most often missing `mobile/assets/icon.png` and `splash.png`. Drop any 1024×1024 PNG named `icon.png` and any 1242×2436 PNG named `splash.png` into `mobile/assets/`. |

---

That's it. Three URLs (web mobile, web desktop, APK) backed by one engine. All offline-first. All sharing the same data model.
