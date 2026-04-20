# Build the InventoryIQ Android APK (Option 2)

This guide turns the `/app/mobile/` folder into an installable Android `.apk` you can share or sideload onto any Android phone.

Takes ~20 min total. **No Android Studio needed.** Expo's cloud builds the APK for you.

---

## Prerequisites (one-time setup)

| What | Why | Install |
|---|---|---|
| **Node.js 18+** | To run Expo CLI locally | https://nodejs.org (pick LTS) |
| **Expo account** (free) | Needed for cloud builds | https://expo.dev/signup |
| **GitHub account** | To pull your code | You already have one |

---

## Step 1 — Push this project to GitHub

In the Emergent chat input, click the **"Save to GitHub"** button. Pick a repo name (e.g. `inventoryiq`) and push. Wait for the confirmation.

## Step 2 — Clone to your computer

Open a terminal (Command Prompt on Windows, Terminal on Mac) and run:

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>/mobile
```

## Step 3 — Install dependencies

```bash
npm install -g eas-cli
npm install          # (or: yarn install)
```

## Step 4 — Log in & link your Expo project

```bash
eas login            # enter your Expo email + password
eas init             # creates the project on Expo's cloud, writes projectId into app.json
```

When `eas init` asks **"What would you like your Android package to be named?"** — keep the default `com.inventoryiq.app` (already configured).

When it asks for the **owner** — use your Expo username.

## Step 5 — Build the APK

```bash
eas build --platform android --profile preview
```

Expo will:
1. Zip your code and upload it to their cloud builders (~1 min)
2. Build a signed APK on their Android build servers (~8–12 min)
3. Send you an email + show a link in the terminal

## Step 6 — Download & install on your phone

- The build page shows a **QR code + direct download link**.
- On your Android phone: open the link in Chrome → tap the APK → confirm install.
  - First time only: Android asks **"Allow installs from Chrome?"** → tap **Settings → Allow** → go back.
- InventoryIQ icon appears in your app drawer like any other app.

---

## Sharing with anyone (no Play Store)

The download link from Expo works for **any Android device** — just send it via WhatsApp / email. The APK is signed with a test certificate, so anyone can install it without a developer account.

For the Play Store, change `"buildType": "apk"` → `"app-bundle"` in `eas.json` → rebuild with `--profile production`.

---

## Local data & backend

| Aspect | How it works |
|---|---|
| **Local storage** | All inventory data lives in AsyncStorage on the phone — works 100% offline |
| **Backend URL** | Pre-wired to `https://inventory-ai-51.preview.emergentagent.com` (set in `app.json` → `extra.apiBaseUrl`) |
| **Change backend** | Edit the URL in `app.json`, then run `eas build` again to produce a new APK |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `eas: command not found` | `npm install -g eas-cli` (restart terminal after) |
| Build fails with "package name already in use" | Change `"package": "com.inventoryiq.app"` in `app.json` to something unique like `com.yourname.inventoryiq` |
| APK crashes on open | Run `npx expo-doctor` — usually a Node version mismatch. Use Node 18 or 20 |
| Install blocked on phone | Android → Settings → Apps → Special access → Install unknown apps → Allow Chrome |

---

## Want iOS too?

Run `eas build --platform ios --profile preview` — but you need a **paid Apple Developer account (₹8,000/year)**. For a college project, Android APK is more than enough.
