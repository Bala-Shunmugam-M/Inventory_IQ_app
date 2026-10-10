# InventoryIQ backend (Cloudflare Worker + D1)

One Worker that:

- stores each shop's data (products + sales log) as a versioned snapshot in D1, so
  several phones / the desktop dashboard can share one store, and
- proxies the AI Advisor to Groq so the API key never ships in the app.

It replaces the old `proxy/` worker and keeps its name (`inventoryiq-llm-proxy`), so the
already-deployed `*.workers.dev` URL and its `POST /` AI endpoint keep working.

## Deploy

```bash
npm i -g wrangler
wrangler login
cd backend

wrangler d1 create inventoryiq            # copy the printed database_id into wrangler.toml
wrangler d1 execute inventoryiq --remote --file=schema.sql
wrangler secret put GROQ_API_KEY          # paste gsk_... when prompted
wrangler deploy
```

Wrangler prints `https://inventoryiq-llm-proxy.<you>.workers.dev`.

## Test

```bash
node backend/test/run.mjs     # Node 22.5+; uses built-in node:sqlite as a D1 stand-in, no npm install
```

## API

All bodies are JSON. Errors are `{ "error": "<message>" }`.

### `GET /api/health`

`200 { "ok": true }`

### `POST /api/stores`

No body. Creates an empty store.

`201 { "storeId": "IQ-7KQ2M4XZ3A", "token": "<43-char base64url>" }`

- The token is shown **once**. Only its SHA-256 is stored; a lost token cannot be recovered.
- `429` when the per-IP limit (20/min, `LIMITER`) is hit.

### `GET /api/stores/:id/snapshot`

Header `Authorization: Bearer <token>`.

`200 { "version": 3, "updatedAt": "2026-10-08T10:15:00.000Z", "products": [...], "sales": [...], "events": [...] }`

A store that was never saved returns `version: 0`, `updatedAt: null` and empty arrays
(not 404), so the first push is always `baseVersion: 0`.

### `PUT /api/stores/:id/snapshot`

Header `Authorization: Bearer <token>`. Body:

```json
{ "baseVersion": 3, "products": [{ "id": 1, "name": "Atta 5kg", "stock": 12 }], "sales": [], "events": [] }
```

| Status | Body | When |
|---|---|---|
| 200 | `{ "version": 4, "updatedAt": "..." }` | saved; `baseVersion` matched |
| 409 | `{ "error", "version", "updatedAt" }` | `baseVersion` is not the current version — nothing was written; GET, merge, retry |
| 400 | `{ "error" }` | not JSON; `baseVersion` not an integer; `products` not an array, > 5000 items, or an item without a finite numeric `id`; `sales` not an array/null; `events` not an array/null, > 5000 items, or an item without a string `id` (≤ 64 chars) |
| 413 | `{ "error" }` | body > 1 MB |

`sales` and `events` null (or missing) are stored as `[]`. The snapshot replaces the previous one whole.
`events` is the clients' stock event log (sale / order / receive / adjust / close, each with a unique `id`);
on a 409 clients merge by replaying the events the base hadn't seen, so the server only stores it.

### Auth errors (both snapshot routes)

`401 { "error": "Unauthorized" }` for a missing/wrong token **and** for an unknown store id,
so the API never reveals which store ids exist.

### `POST /api/ai` (alias: `POST /`)

Body `{ "messages": [{ "role": "user", "content": "..." }], "temperature"?, "max_tokens"? }`.
Returns Groq's chat-completion JSON unchanged. Model is pinned, `max_tokens` capped at 2000,
body capped at 64 KB, 20 calls/min per IP, and a **global cap of 300 calls per UTC day** across all
users (counted in D1 table `ai_usage`; change it with a `AI_DAILY_CAP` var in wrangler.toml).
Origin checks only stop browsers — the per-IP limit and the daily cap are what bound the Groq bill,
so the route refuses to run (503) without the `LIMITER` and `DB` bindings.

`403` origin not in `ALLOWED_ORIGINS` · `400` bad body · `413` too large · `429` rate limited or daily cap reached ·
`500` `GROQ_API_KEY` missing · `502` upstream unreachable · `503` LIMITER/DB binding missing.

Upgrading an existing deploy? Re-run the schema (`wrangler d1 execute inventoryiq --remote --file=schema.sql`) —
it only adds the `ai_usage` table. A `stores` table from before the `events` column also needs, once:
`wrangler d1 execute inventoryiq --remote --command "ALTER TABLE stores ADD COLUMN events TEXT NOT NULL DEFAULT '[]'"`.

## CORS

- `/api/stores*` and `/api/health`: `Access-Control-Allow-Origin: *`. These routes are
  authenticated by a bearer token, not cookies, so allowing other origins gives them nothing
  they don't already have; the Expo app sends no `Origin` at all.
- `/api/ai` and `/`: only origins in `ALLOWED_ORIGINS` (GitHub Pages). Add
  `http://localhost:<port>` there for local testing. Origin checks only stop browsers; the
  rate limit is what stops scripts.

Preflight (`OPTIONS`) allows `GET, PUT, POST` and the `Authorization, Content-Type` headers.

## Linking a second device

A device needs `storeId` + `token`. Show/scan them as one **link code**:

```
iq1:IQ-7KQ2M4XZ3A:<token>
```

`iq1` is the format version; split on `:` (neither the id nor the base64url token contains one).
About 60 characters, so it fits a small QR code. Treat it like a password.
